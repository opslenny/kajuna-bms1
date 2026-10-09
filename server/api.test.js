import 'dotenv/config'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import pg from 'pg'
import { hashPassword } from './auth/password.js'
import { convertCurrency } from './currency.js'

if (!process.env.DATABASE_URL?.includes('kajuna_api_test_')) {
  throw new Error('API integration tests must run against the isolated temporary test database.')
}

const { Pool } = pg
const { pool } = await import('./db/pool.js')
const ownerPool = new Pool({ connectionString: process.env.MIGRATION_DATABASE_URL })
const { createApiApp } = await import('./api.js')
const app = createApiApp()
const origin = process.env.APP_ORIGIN || 'http://localhost:5173'
let server
let baseUrl
let primaryBusinessId
let secondaryBusinessId
const originalFetch = globalThis.fetch
const testRates = { USD: 1, TZS: 2500, KES: 130, UGX: 3700, EUR: 0.92, GBP: 0.79 }

test('currency conversion uses the original denomination without mutating stored values', () => {
  const rates = { USD: 1, TZS: 2500, KES: 130 }
  assert.equal(convertCurrency(2500, 'TZS', 'USD', rates), 1)
  assert.equal(convertCurrency(1, 'USD', 'KES', rates), 130)
  assert.equal(convertCurrency(300, 'TZS', 'USD', rates), 0.12)
  assert.equal(convertCurrency(300, 'TZS', 'USD', { ...rates, TZS: 5000 }), 0.06)
})

before(async () => {
  globalThis.fetch = async (input, options) => {
    if (String(input) === 'https://open.er-api.com/v6/latest/USD') {
      const updatedAt = Math.floor(Date.now() / 1000)
      return new Response(JSON.stringify({
        result: 'success',
        base_code: 'USD',
        time_last_update_unix: updatedAt,
        time_next_update_unix: updatedAt + 86_400,
        rates: testRates,
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input, options)
  }
  const { rows } = await ownerPool.query('SELECT count(*)::integer AS count FROM users')
  assert.equal(rows[0].count, 0, 'The temporary API database must not contain users.')
  server = app.listen(0, '127.0.0.1')
  await new Promise((resolve, reject) => {
    server.once('listening', resolve)
    server.once('error', reject)
  })
  baseUrl = `http://127.0.0.1:${server.address().port}/api`
})

after(async () => {
  if (primaryBusinessId || secondaryBusinessId) {
    await ownerPool.query(
      `DELETE FROM businesses WHERE id = ANY($1::uuid[])`,
      [[primaryBusinessId, secondaryBusinessId].filter(Boolean)],
    )
  }
  await ownerPool.query(`DELETE FROM business_registration_requests WHERE email LIKE 'api-test-%'`)
  if (server) await new Promise((resolve) => server.close(resolve))
  globalThis.fetch = originalFetch
  await pool.end()
  await ownerPool.end()
})

async function request(path, { cookie, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.method && options.method !== 'GET' ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
  })
  const payload = response.status === 204 ? null : await response.json()
  return { response, payload, cookie: response.headers.get('set-cookie')?.split(';')[0] }
}

function json(method, body) {
  return { method, body: JSON.stringify(body) }
}

test('authentication, tenant isolation, and business workflows use PostgreSQL', async () => {
  const health = await request('/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.payload.status, 'ok')

  const config = await request('/config')
  assert.equal(config.response.status, 200)
  assert.equal(config.payload.googleClientId, process.env.GOOGLE_CLIENT_ID || null)
  const googleSignIn = await request('/auth/google', {
    ...json('POST', { credential: 'not-a-google-token' }),
  })
  assert.equal(googleSignIn.response.status, process.env.GOOGLE_CLIENT_ID ? 401 : 503)

  const setup = await request('/setup')
  assert.equal(setup.payload.setupRequired, true)

  const registration = await request('/auth/register-business', {
    ...json('POST', {
      businessName: 'API Test Business',
      ownerName: 'API Test Admin',
      email: 'api-test-admin@example.invalid',
      phone: '+255700000001',
      industry: 'Retail',
      password: 'api-test-password-123',
      setupToken: process.env.SETUP_TOKEN,
    }),
  })
  assert.equal(registration.response.status, 201, JSON.stringify(registration.payload))
  primaryBusinessId = registration.payload.user.businessId
  let adminCookie = registration.cookie
  assert.ok(adminCookie)
  assert.equal((await request('/setup')).payload.setupRequired, false)
  assert.equal(registration.payload.user.role, 'business_admin')
  const restoredSession = await request('/auth/me', { cookie: adminCookie })
  assert.equal(restoredSession.response.status, 200)
  assert.equal(restoredSession.payload.user.id, registration.payload.user.id)
  const currencyRates = await request('/currency-rates')
  assert.deepEqual(currencyRates.payload.supportedCurrencies, ['TZS', 'KES', 'UGX', 'USD', 'EUR', 'GBP'])
  assert.equal(currencyRates.payload.rates.TZS, 2500)
  const currencyConversion = await request('/currency-convert', {
    ...json('POST', { amount: 10, fromCurrency: 'USD', toCurrency: 'KES' }),
    cookie: adminCookie,
  })
  assert.equal(currencyConversion.response.status, 200)
  assert.equal(currencyConversion.payload.convertedAmount, 1300)
  assert.equal(currencyConversion.payload.rate, 130)
  for (let index = 0; index < currencyRates.payload.supportedCurrencies.length; index += 1) {
    const fromCurrency = currencyRates.payload.supportedCurrencies[index]
    const toCurrency = currencyRates.payload.supportedCurrencies[(index + 1) % currencyRates.payload.supportedCurrencies.length]
    const result = await request('/currency-convert', {
      ...json('POST', { amount: 100, fromCurrency, toCurrency }),
      cookie: adminCookie,
    })
    const expectedRate = testRates[toCurrency] / testRates[fromCurrency]
    assert.equal(result.response.status, 200, JSON.stringify(result.payload))
    assert.equal(result.payload.rate, expectedRate)
    assert.equal(result.payload.convertedAmount, Math.round(100 * expectedRate * 100) / 100)
  }
  assert.equal((await request('/currency-convert', {
    ...json('POST', { amount: 10, fromCurrency: 'XYZ', toCurrency: 'KES' }),
    cookie: adminCookie,
  })).response.status, 400)
  assert.equal((await request('/currency-convert', {
    ...json('POST', { amount: -1, fromCurrency: 'USD', toCurrency: 'TZS' }),
    cookie: adminCookie,
  })).response.status, 400)
  assert.equal((await request('/dashboard', { cookie: adminCookie })).response.status, 200)

  const updateBusinessProfile = await request('/business', {
    ...json('PATCH', { name: 'API Test Updated Business', phone: '+255700000099' }),
    cookie: adminCookie,
  })
  assert.equal(updateBusinessProfile.response.status, 200)
  assert.equal(updateBusinessProfile.payload.business.name, 'API Test Updated Business')
  assert.equal(updateBusinessProfile.payload.business.phone, '+255700000099')
  const updateBusinessPreferences = await request('/business', {
    ...json('PATCH', { currency: 'TZS', timezone: 'Africa/Dar_es_Salaam' }),
    cookie: adminCookie,
  })
  assert.equal(updateBusinessPreferences.response.status, 200)
  const unsupportedBusinessCurrency = await request('/business', {
    ...json('PATCH', { currency: 'CAD' }),
    cookie: adminCookie,
  })
  assert.equal(unsupportedBusinessCurrency.response.status, 400)
  const businessProfile = await request('/business', { cookie: adminCookie })
  assert.equal(businessProfile.payload.business.name, 'API Test Updated Business')
  assert.equal(businessProfile.payload.business.phone, '+255700000099')
  assert.equal(businessProfile.payload.business.timezone, 'Africa/Dar_es_Salaam')

  const pendingRegistration = await request('/auth/register-business', {
    ...json('POST', {
      businessName: 'API Test Pending',
      ownerName: 'API Pending Owner',
      email: 'api-test-pending@example.invalid',
      phone: '+255700000004',
      industry: 'Services',
      password: 'api-pending-password-123',
    }),
  })
  assert.equal(pendingRegistration.response.status, 202)
  const pendingLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-pending@example.invalid', password: 'api-pending-password-123' }),
  })
  assert.equal(pendingLogin.response.status, 403)
  assert.match(pendingLogin.payload.error, /pending owner approval/i)
  const { rows: pendingRows } = await ownerPool.query(
    `SELECT status FROM business_registration_requests WHERE email = 'api-test-pending@example.invalid'`,
  )
  assert.equal(pendingRows[0].status, 'pending')
  const rejectedRegistration = await request('/auth/register-business', {
    ...json('POST', {
      businessName: 'API Test Rejected',
      ownerName: 'API Rejected Owner',
      email: 'api-test-rejected@example.invalid',
      phone: '+255700000005',
      industry: 'Services',
      password: 'api-rejected-password-123',
    }),
  })
  assert.equal(rejectedRegistration.response.status, 202)

  const productResponse = await request('/products', {
    ...json('POST', { name: 'API Test Product', sku: 'API-TEST-1', buyingPrice: 100, sellingPrice: 150, quantity: 8 }),
    cookie: adminCookie,
  })
  assert.equal(productResponse.response.status, 201, JSON.stringify(productResponse.payload))
  const productId = productResponse.payload.product.id
  assert.equal(productResponse.payload.product.sku, 'API-TEST-1')
  const { rows: savedProduct } = await ownerPool.query(
    'SELECT sku, buying_price, selling_price, currency FROM products WHERE business_id = $1 AND id = $2',
    [primaryBusinessId, productId],
  )
  assert.ok(savedProduct[0], 'Successful product responses are sent only after the database transaction commits.')
  assert.equal(savedProduct[0].sku, 'API-TEST-1')
  assert.equal(savedProduct[0].buying_price, '100.00')
  assert.equal(savedProduct[0].selling_price, '150.00')
  assert.equal(savedProduct[0].currency, 'TZS')

  const invalidPrice = await request('/products', {
    ...json('POST', { name: 'Bad Product', sku: 'API-TEST-BAD', buyingPrice: 100, sellingPrice: 90, quantity: 1 }),
    cookie: adminCookie,
  })
  assert.equal(invalidPrice.response.status, 400)

  const restock = await request(`/products/${productId}/restock`, {
    ...json('POST', { quantity: 2 }),
    cookie: adminCookie,
  })
  assert.equal(restock.response.status, 200)
  assert.equal(restock.payload.product.stock, 10)

  const failedSale = await request('/sales', {
    ...json('POST', { items: [{ productId, quantity: 11 }] }),
    cookie: adminCookie,
  })
  assert.equal(failedSale.response.status, 409)
  const adminSale = await request('/sales', {
    ...json('POST', { customer: 'Test customer', items: [{ productId, quantity: 2 }] }),
    cookie: adminCookie,
  })
  assert.equal(adminSale.response.status, 201, JSON.stringify(adminSale.payload))
  assert.equal(adminSale.payload.sale.amount, 300)
  assert.equal(adminSale.payload.sale.profit, 100)
  const { rows: storedSaleAmounts } = await ownerPool.query(
    `SELECT s.total, s.currency AS sale_currency, si.gross_profit, si.currency AS item_currency
    FROM sales s JOIN sale_items si ON si.business_id = s.business_id AND si.sale_id = s.id
    WHERE s.business_id = $1 AND s.id = $2`,
    [primaryBusinessId, adminSale.payload.sale.saleId],
  )
  assert.equal(storedSaleAmounts[0].total, '300.00')
  assert.equal(storedSaleAmounts[0].gross_profit, '100.00')
  assert.equal(storedSaleAmounts[0].sale_currency, 'TZS')
  assert.equal(storedSaleAmounts[0].item_currency, 'TZS')
  const { rows: savedSaleSnapshot } = await ownerPool.query(
    `SELECT converted_total, converted_currency, exchange_rate, exchange_rates, fx_rate_updated_at
    FROM sales WHERE business_id = $1 AND id = $2`,
    [primaryBusinessId, adminSale.payload.sale.saleId],
  )
  assert.equal(savedSaleSnapshot[0].converted_total, '300.00')
  assert.equal(savedSaleSnapshot[0].converted_currency, 'TZS')
  assert.equal(savedSaleSnapshot[0].exchange_rate, '0.0004000000000000')
  assert.equal(savedSaleSnapshot[0].exchange_rates.TZS, 2500)
  assert.ok(savedSaleSnapshot[0].fx_rate_updated_at)

  const expense = await request('/expenses', {
    ...json('POST', { category: 'Testing', description: 'API test expense', amount: 25 }),
    cookie: adminCookie,
  })
  assert.equal(expense.response.status, 201)
  assert.ok(expense.payload?.expense, JSON.stringify(expense.payload))
  assert.equal(expense.payload.expense.amount, 25)
  const { rows: storedExpense } = await ownerPool.query(
    'SELECT amount, currency FROM expenses WHERE business_id = $1 AND id = $2',
    [primaryBusinessId, expense.payload.expense.id],
  )
  assert.equal(storedExpense[0].amount, '25.00')
  assert.equal(storedExpense[0].currency, 'TZS')
  const { rows: savedExpenseSnapshot } = await ownerPool.query(
    `SELECT converted_amount, converted_currency, exchange_rate, exchange_rates, fx_rate_updated_at
    FROM expenses WHERE business_id = $1 AND id = $2`,
    [primaryBusinessId, expense.payload.expense.id],
  )
  assert.equal(savedExpenseSnapshot[0].converted_amount, '25.00')
  assert.equal(savedExpenseSnapshot[0].converted_currency, 'TZS')
  assert.equal(savedExpenseSnapshot[0].exchange_rate, '0.0004000000000000')
  assert.equal(savedExpenseSnapshot[0].exchange_rates.USD, 1)
  assert.ok(savedExpenseSnapshot[0].fx_rate_updated_at)
  const savedExpenses = await request('/expenses', { cookie: adminCookie })
  const savedExpense = savedExpenses.payload.expenses.find((row) => row.id === expense.payload.expense.id)
  assert.ok(savedExpense, 'expense is stored and available to the business admin')
  assert.equal(savedExpense.amount, 25)
  assert.match(savedExpense.expense_date, /^\d{4}-\d{2}-\d{2}$/)

  const agentResponse = await request('/staff', {
    ...json('POST', {
      name: 'API Test Agent',
      email: 'api-test-agent@example.invalid',
      phone: '+255700000002',
      password: 'api-agent-password-123',
    }),
    cookie: adminCookie,
  })
  assert.equal(agentResponse.response.status, 201)
  const agent = agentResponse.payload.agent
  const agentLogin = await request('/auth/login', {
    ...json('POST', { email: agent.email, password: 'api-agent-password-123' }),
  })
  assert.equal(agentLogin.response.status, 200)
  assert.equal(agentLogin.payload.user.role, 'sales_agent')
  const agentCookie = agentLogin.cookie
  assert.equal((await request('/dashboard', { cookie: agentCookie })).response.status, 403)
  const agentSale = await request('/sales', {
    ...json('POST', { items: [{ productId, quantity: 1 }] }),
    cookie: agentCookie,
  })
  assert.equal(agentSale.response.status, 201)
  assert.equal((await request('/sales', { cookie: agentCookie })).payload.sales.length, 1)
  const businessSales = await request('/sales', { cookie: adminCookie })
  assert.equal(businessSales.payload.sales.length, 2)
  assert.ok(businessSales.payload.sales.some((sale) => sale.soldBy === 'API Test Admin'))
  assert.ok(businessSales.payload.sales.some((sale) => sale.soldBy === 'API Test Agent'))
  assert.ok(businessSales.payload.sales.every((sale) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(sale.businessDateTime)))
  const { rows: businessDayRows } = await ownerPool.query(
    'SELECT timezone(timezone, now())::date::text AS today FROM businesses WHERE id = $1',
    [primaryBusinessId],
  )
  const businessToday = businessDayRows[0].today
  const salesOnBusinessDate = await request(`/sales?date=${businessToday}`, { cookie: adminCookie })
  assert.equal(salesOnBusinessDate.response.status, 200)
  assert.equal(salesOnBusinessDate.payload.sales.length, 2)
  const agentSalesOnBusinessDate = await request(`/sales?date=${businessToday}`, { cookie: agentCookie })
  assert.equal(agentSalesOnBusinessDate.payload.sales.length, 1)
  assert.equal((await request('/sales?date=2026-02-30', { cookie: adminCookie })).response.status, 400)
  assert.equal((await request('/sales?date=2000-01-01', { cookie: adminCookie })).payload.sales.length, 0)

  const dashboard = await request('/dashboard', { cookie: adminCookie })
  assert.equal(dashboard.response.status, 200)
  assert.equal(dashboard.payload.metrics.todaySales, 450, 'dashboard sales include admin and agent transactions')
  assert.equal(dashboard.payload.metrics.revenue, 450)
  assert.equal(dashboard.payload.metrics.profit, 150)
  assert.equal(dashboard.payload.metrics.expenses, 25)
  assert.equal(dashboard.payload.metrics.todayExpenses, 25)
  assert.equal(dashboard.payload.metrics.productsSold, 3)
  assert.equal(dashboard.payload.metrics.inventoryValue, 700)
  assert.equal(dashboard.payload.chart.length, 1)
  const { rows: databaseDate } = await ownerPool.query(
    'SELECT timezone(timezone, now())::date::text AS today FROM businesses WHERE id = $1',
    [primaryBusinessId],
  )
  const today = databaseDate[0].today
  assert.equal(savedExpense.expense_date, today)
  const datedDashboard = await request(`/dashboard?range=today&date=${today}`, { cookie: adminCookie })
  assert.equal(datedDashboard.payload.chart[0].revenue, 450)
  assert.equal(datedDashboard.payload.chart[0].expenses, 25)
  assert.equal(datedDashboard.payload.chart[0].netProfit, 125)
  const weekChart = await request(`/dashboard?range=week&date=${today}`, { cookie: adminCookie })
  const quarterChart = await request(`/dashboard?range=3months&date=${today}`, { cookie: adminCookie })
  const yearChart = await request(`/dashboard?range=year&date=${today}`, { cookie: adminCookie })
  const selectedDateChart = await request(`/dashboard?range=day&date=${today}`, { cookie: adminCookie })
  const invalidChartDate = await request('/dashboard?range=day&date=2026-02-30', { cookie: adminCookie })
  assert.equal(weekChart.payload.chart.length, 7)
  assert.ok(quarterChart.payload.chart.length >= 89 && quarterChart.payload.chart.length <= 92)
  assert.equal(yearChart.payload.chart.length, 12)
  assert.equal(selectedDateChart.payload.chart.length, 1)
  assert.equal(invalidChartDate.response.status, 400)

  const originalFetch = globalThis.fetch
  const updatedAt = Math.floor(Date.now() / 1000)
  globalThis.fetch = async (input, options) => {
    if (String(input) === 'https://open.er-api.com/v6/latest/USD') {
      return new Response(JSON.stringify({
        result: 'success',
        base_code: 'USD',
        time_last_update_unix: updatedAt,
        time_next_update_unix: updatedAt + 86_400,
        rates: { USD: 1, TZS: 2500, KES: 130 },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input, options)
  }
  try {
    const unsupportedCurrency = await request('/business', {
      ...json('PATCH', { currency: 'XYZ' }),
      cookie: adminCookie,
    })
    assert.equal(unsupportedCurrency.response.status, 400)
    const changeCurrency = await request('/business', {
      ...json('PATCH', { currency: 'USD' }),
      cookie: adminCookie,
    })
    assert.equal(changeCurrency.response.status, 200)
    const convertedProducts = await request('/products', { cookie: adminCookie })
    assert.equal(convertedProducts.payload.products.find((product) => product.id === productId).sellingPrice, 0.06)
    const convertedSales = await request('/sales', { cookie: adminCookie })
    assert.ok(Math.abs(convertedSales.payload.sales.reduce((sum, sale) => sum + sale.amount, 0) - 0.18) < 0.000001)
    const convertedExpenses = await request('/expenses', { cookie: adminCookie })
    assert.ok(Math.abs(convertedExpenses.payload.expenses.find((row) => row.id === expense.payload.expense.id).amount - 0.01) < 0.000001)
    const convertedDashboard = await request('/dashboard', { cookie: adminCookie })
    assert.ok(Math.abs(convertedDashboard.payload.metrics.todaySales - 0.18) < 0.000001)
    assert.ok(Math.abs(convertedDashboard.payload.metrics.todayExpenses - 0.01) < 0.000001)
    assert.ok(Math.abs(convertedDashboard.payload.metrics.inventoryValue - 0.28) < 0.000001)
    assert.ok(Math.abs(convertedDashboard.payload.chart[0].netProfit - 0.05) < 0.000001)
    const { rows: unchangedAmounts } = await ownerPool.query(
      `SELECT (SELECT selling_price FROM products WHERE business_id = $1 AND id = $2) AS product_price,
        (SELECT total FROM sales WHERE business_id = $1 AND id = $3) AS sale_total,
        (SELECT amount FROM expenses WHERE business_id = $1 AND id = $4) AS expense_amount,
        (SELECT currency FROM businesses WHERE id = $1) AS display_currency`,
      [primaryBusinessId, productId, adminSale.payload.sale.saleId, expense.payload.expense.id],
    )
    assert.equal(unchangedAmounts[0].product_price, '150.00')
    assert.equal(unchangedAmounts[0].sale_total, '300.00')
    assert.equal(unchangedAmounts[0].expense_amount, '25.00')
    assert.equal(unchangedAmounts[0].display_currency, 'USD')
    await ownerPool.query(
      `UPDATE sales SET exchange_rates = NULL, exchange_rate = NULL, converted_total = NULL,
        converted_currency = NULL, fx_rate_updated_at = NULL
      WHERE business_id = $1 AND id = $2`,
      [primaryBusinessId, adminSale.payload.sale.saleId],
    )
    const rejectedUnconfirmedCurrencyChange = await request('/business', {
      ...json('PATCH', { currency: 'EUR' }),
      cookie: adminCookie,
    })
    assert.equal(rejectedUnconfirmedCurrencyChange.response.status, 409)
    const confirmedCurrencyChange = await request('/business', {
      ...json('PATCH', { currency: 'EUR', confirmHistoricalConversion: true }),
      cookie: adminCookie,
    })
    assert.equal(confirmedCurrencyChange.response.status, 200)
    const { rows: preservedAfterBackfill } = await ownerPool.query(
      `SELECT total, currency, converted_total, converted_currency, exchange_rates
      FROM sales WHERE business_id = $1 AND id = $2`,
      [primaryBusinessId, adminSale.payload.sale.saleId],
    )
    assert.equal(preservedAfterBackfill[0].total, '300.00')
    assert.equal(preservedAfterBackfill[0].currency, 'TZS')
    assert.equal(preservedAfterBackfill[0].converted_total, '0.11')
    assert.equal(preservedAfterBackfill[0].converted_currency, 'EUR')
    assert.equal(preservedAfterBackfill[0].exchange_rates.TZS, 2500)
    const restoreCurrency = await request('/business', {
      ...json('PATCH', { currency: 'TZS' }),
      cookie: adminCookie,
    })
    assert.equal(restoreCurrency.response.status, 200)
  } finally {
    globalThis.fetch = originalFetch
  }

  const secondaryName = 'api-test-secondary@example.invalid'
  const secondaryPasswordHash = await hashPassword('api-secondary-password-123')
  const { rows: businesses } = await ownerPool.query(
    `INSERT INTO businesses (name, slug, email, phone, industry, status)
    VALUES ('API Test Secondary', 'api-test-secondary-${Date.now()}', $1, '+255700000003', 'Retail', 'active')
    RETURNING id, name, currency`,
    [secondaryName],
  )
  secondaryBusinessId = businesses[0].id
  await ownerPool.query(
    `INSERT INTO users (business_id, full_name, email, phone, password_hash, role, status)
    VALUES ($1, 'Secondary Admin', $2, '+255700000003', $3, 'business_admin', 'active')`,
    [secondaryBusinessId, secondaryName, secondaryPasswordHash],
  )
  const secondaryLogin = await request('/auth/login', {
    ...json('POST', { email: secondaryName, password: 'api-secondary-password-123' }),
  })
  assert.equal(secondaryLogin.response.status, 200)
  assert.equal(secondaryLogin.payload.user.role, 'business_admin')
  const isolatedProducts = await request('/products', { cookie: secondaryLogin.cookie })
  assert.equal(isolatedProducts.response.status, 200)
  assert.equal(isolatedProducts.payload.products.length, 0)

  const ownerSetup = await request('/auth/register-platform-owner', {
    ...json('POST', {
      name: 'API Test Platform Owner',
      email: 'api-test-platform-owner@example.invalid',
      password: 'api-platform-owner-password-123',
      setupToken: process.env.SETUP_TOKEN,
    }),
  })
  assert.equal(ownerSetup.response.status, 201, JSON.stringify(ownerSetup.payload))
  assert.equal(ownerSetup.payload.user.role, 'platform_admin')
  const ownerCookie = ownerSetup.cookie
  assert.ok(ownerCookie)

  const { rows: secondaryUsers } = await ownerPool.query(
    'SELECT id FROM users WHERE business_id = $1 AND role = $2',
    [secondaryBusinessId, 'business_admin'],
  )
  const { rows: categories } = await ownerPool.query(
    `INSERT INTO categories (business_id, name)
    VALUES ($1, 'API Test Delete Category') RETURNING id`,
    [secondaryBusinessId],
  )
  const { rows: products } = await ownerPool.query(
    `INSERT INTO products (business_id, category_id, name, sku, buying_price, selling_price, quantity)
    VALUES ($1, $2, 'API Test Delete Product', 'API-DELETE-001', 10, 20, 4) RETURNING id`,
    [secondaryBusinessId, categories[0].id],
  )
  const { rows: sales } = await ownerPool.query(
    `INSERT INTO sales (business_id, receipt_number, subtotal, total)
    VALUES ($1, $2, 20, 20) RETURNING id`,
    [secondaryBusinessId, `API-DELETE-${Date.now()}`],
  )
  await ownerPool.query(
    `INSERT INTO sale_items (business_id, sale_id, product_id, product_name, quantity, unit_buying_price, unit_selling_price)
    VALUES ($1, $2, $3, 'API Test Delete Product', 1, 10, 20)`,
    [secondaryBusinessId, sales[0].id, products[0].id],
  )
  await ownerPool.query(
    `INSERT INTO expenses (business_id, recorded_by, category, description, amount)
    VALUES ($1, $2, 'Testing', 'Permanent deletion test', 20)`,
    [secondaryBusinessId, secondaryUsers[0].id],
  )

  const platformBusinesses = await request('/platform/businesses', { cookie: ownerCookie })
  assert.equal(platformBusinesses.response.status, 200)
  assert.ok(platformBusinesses.payload.businesses.some((business) => business.id === primaryBusinessId))
  assert.equal((await request('/platform/businesses', { cookie: adminCookie })).response.status, 403)
  const initialPlan = await request('/platform/subscription-plan', { cookie: ownerCookie })
  assert.equal(initialPlan.response.status, 200)
  assert.equal(initialPlan.payload.plan.currency, 'TZS')
  assert.equal(initialPlan.payload.plan.billingPeriod, 'monthly')
  assert.equal((await request('/platform/subscription-plan', { cookie: adminCookie })).response.status, 403)
  assert.equal((await request('/platform/subscription-plan', { cookie: ownerCookie, ...json('PATCH', { amount: 0 }) })).response.status, 400)
  assert.equal((await request('/platform/subscription-plan', { cookie: ownerCookie, ...json('PATCH', { amount: 0.001 }) })).response.status, 400)
  assert.equal((await request('/platform/subscription-plan', { cookie: ownerCookie, ...json('PATCH', { amount: 'invalid' }) })).response.status, 400)
  const { rows: primarySubscription } = await ownerPool.query(
    'SELECT id FROM subscriptions WHERE business_id = $1 ORDER BY created_at DESC LIMIT 1',
    [primaryBusinessId],
  )
  assert.ok(primarySubscription[0], 'Initial business should have its monthly subscription.')
  const { rows: historicalPayments } = await ownerPool.query(
    `INSERT INTO payments (business_id, subscription_id, amount, currency, payment_method, status, paid_at)
    VALUES ($1, $2, 12345.67, 'TZS', 'cash', 'succeeded', now()) RETURNING id`,
    [primaryBusinessId, primarySubscription[0].id],
  )
  const updatedPlan = await request('/platform/subscription-plan', {
    ...json('PATCH', { amount: 245678.9 }),
    cookie: ownerCookie,
  })
  assert.equal(updatedPlan.response.status, 200, JSON.stringify(updatedPlan.payload))
  assert.equal(updatedPlan.payload.plan.amount, 245678.9)
  const dashboardWithUpdatedPlan = await request('/dashboard', { cookie: adminCookie })
  assert.equal(dashboardWithUpdatedPlan.response.status, 200)
  assert.equal(dashboardWithUpdatedPlan.payload.subscription.price, 245678.9)
  const ownerBusinessesWithUpdatedPlan = await request('/platform/businesses', { cookie: ownerCookie })
  assert.equal(
    ownerBusinessesWithUpdatedPlan.payload.businesses.find((business) => business.id === primaryBusinessId).planPrice,
    245678.9,
  )
  const { rows: preservedPayment } = await ownerPool.query(
    'SELECT amount FROM payments WHERE id = $1',
    [historicalPayments[0].id],
  )
  assert.equal(Number(preservedPayment[0].amount), 12345.67)
  const { rows: pricingAudit } = await ownerPool.query(
    `SELECT details FROM audit_logs
    WHERE action = 'platform_subscription_price_updated' AND entity_id = $1
    ORDER BY created_at DESC LIMIT 1`,
    [updatedPlan.payload.plan.id],
  )
  assert.equal(Number(pricingAudit[0].details.amount), 245678.9)
  assert.equal(Number(pricingAudit[0].details.previousAmount), initialPlan.payload.plan.amount)
  const registrationRequests = await request('/platform/registration-requests', { cookie: ownerCookie })
  assert.equal(registrationRequests.response.status, 200)
  assert.equal(registrationRequests.payload.requests.length, 2)
  assert.equal((await request('/platform/registration-requests', { cookie: adminCookie })).response.status, 403)
  const pendingApproval = registrationRequests.payload.requests.find((requestRow) => requestRow.email === 'api-test-pending@example.invalid')
  const pendingRejection = registrationRequests.payload.requests.find((requestRow) => requestRow.email === 'api-test-rejected@example.invalid')
  const approvedRequest = await request(`/platform/registration-requests/${pendingApproval.id}`, {
    ...json('PATCH', { status: 'approved' }),
    cookie: ownerCookie,
  })
  assert.equal(approvedRequest.response.status, 200, JSON.stringify(approvedRequest.payload))
  assert.equal(approvedRequest.payload.status, 'approved')
  assert.equal(approvedRequest.payload.business.status, 'active')
  const approvedLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-pending@example.invalid', password: 'api-pending-password-123' }),
  })
  assert.equal(approvedLogin.response.status, 200)
  assert.equal(approvedLogin.payload.user.role, 'business_admin')
  const approvedDashboard = await request('/dashboard', { cookie: approvedLogin.cookie })
  assert.equal(approvedDashboard.response.status, 200)
  assert.equal(approvedDashboard.payload.subscription.price, 245678.9)
  const { rows: reviewedRequest } = await ownerPool.query(
    `SELECT status, reviewed_by FROM business_registration_requests WHERE email = 'api-test-pending@example.invalid'`,
  )
  assert.equal(reviewedRequest[0].status, 'approved')
  assert.equal(reviewedRequest[0].reviewed_by, ownerSetup.payload.user.id)
  const rejectedRequest = await request(`/platform/registration-requests/${pendingRejection.id}`, {
    ...json('PATCH', { status: 'rejected' }),
    cookie: ownerCookie,
  })
  assert.equal(rejectedRequest.response.status, 200)
  assert.equal(rejectedRequest.payload.status, 'rejected')
  const rejectedAccount = await ownerPool.query(
    'SELECT id FROM users WHERE lower(email) = lower($1)',
    ['api-test-rejected@example.invalid'],
  )
  assert.equal(rejectedAccount.rows.length, 0)

  const rejectedDelete = await request(`/platform/businesses/${secondaryBusinessId}`, {
    ...json('DELETE', { password: 'incorrect-owner-password' }),
    cookie: ownerCookie,
  })
  assert.equal(rejectedDelete.response.status, 403)
  const stillExists = await ownerPool.query(
    'SELECT id FROM businesses WHERE id = $1',
    [secondaryBusinessId],
  )
  assert.equal(stillExists.rows.length, 1)

  const suspendBusiness = await request(`/platform/businesses/${primaryBusinessId}`, {
    ...json('PATCH', { status: 'suspended' }),
    cookie: ownerCookie,
  })
  assert.equal(suspendBusiness.response.status, 200)
  assert.equal(suspendBusiness.payload.business.status, 'suspended')
  assert.equal((await request('/auth/me', { cookie: adminCookie })).response.status, 401)

  const reactivateBusiness = await request(`/platform/businesses/${primaryBusinessId}`, {
    ...json('PATCH', { status: 'active' }),
    cookie: ownerCookie,
  })
  assert.equal(reactivateBusiness.response.status, 200)
  assert.equal(reactivateBusiness.payload.business.status, 'active')
  const reactivatedLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-test-password-123' }),
  })
  assert.equal(reactivatedLogin.response.status, 200)
  adminCookie = reactivatedLogin.cookie

  const deleteBusiness = await request(`/platform/businesses/${secondaryBusinessId}`, {
    ...json('DELETE', { password: 'api-platform-owner-password-123' }),
    cookie: ownerCookie,
  })
  assert.equal(deleteBusiness.response.status, 204)
  const deletedBusinessData = await ownerPool.query(
    `SELECT
      (SELECT count(*)::integer FROM businesses WHERE id = $1) AS businesses,
      (SELECT count(*)::integer FROM users WHERE business_id = $1) AS users,
      (SELECT count(*)::integer FROM categories WHERE business_id = $1) AS categories,
      (SELECT count(*)::integer FROM products WHERE business_id = $1) AS products,
      (SELECT count(*)::integer FROM sales WHERE business_id = $1) AS sales,
      (SELECT count(*)::integer FROM sale_items WHERE business_id = $1) AS sale_items,
      (SELECT count(*)::integer FROM expenses WHERE business_id = $1) AS expenses,
      (SELECT count(*)::integer FROM audit_logs WHERE business_id IS NULL AND entity_id = $1
        AND action = 'platform_business_deleted') AS deletion_audit`,
    [secondaryBusinessId],
  )
  assert.deepEqual(deletedBusinessData.rows[0], {
    businesses: 0,
    users: 0,
    categories: 0,
    products: 0,
    sales: 0,
    sale_items: 0,
    expenses: 0,
    deletion_audit: 1,
  })
  assert.equal((await request('/auth/me', { cookie: secondaryLogin.cookie })).response.status, 401)

  const pauseAgent = await request(`/staff/${agent.id}`, {
    ...json('PATCH', { status: 'paused' }),
    cookie: adminCookie,
  })
  assert.equal(pauseAgent.response.status, 200)
  const pausedLogin = await request('/auth/login', {
    ...json('POST', { email: agent.email, password: 'api-agent-password-123' }),
  })
  assert.equal(pausedLogin.response.status, 403)
  const deleteAgent = await request(`/staff/${agent.id}`, {
    method: 'DELETE',
    cookie: adminCookie,
  })
  assert.equal(deleteAgent.response.status, 204)

  const invalidOrigin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-test-password-123' }),
    headers: { origin: 'https://attacker.invalid' },
  })
  assert.equal(invalidOrigin.response.status, 403)
  assert.equal((await request('/sales')).response.status, 401)

  const logout = await request('/auth/logout', { method: 'POST', body: '{}', cookie: adminCookie })
  assert.equal(logout.response.status, 204)
  assert.equal((await request('/auth/me', { cookie: adminCookie })).response.status, 401)
  assert.equal((await request('/dashboard', { cookie: adminCookie })).response.status, 401)
  adminCookie = null
})
