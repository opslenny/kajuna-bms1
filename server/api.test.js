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
const allowedOrigins = (process.env.APP_ORIGINS || process.env.APP_ORIGIN || 'http://localhost:5173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean)
const origin = allowedOrigins[0]
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

async function requestBinary(path, { cookie, ...options } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.method && options.method !== 'GET' ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
      ...options.headers,
    },
  })
  const isJson = response.headers.get('content-type')?.includes('application/json')
  return {
    response,
    payload: isJson ? await response.json() : Buffer.from(await response.arrayBuffer()),
  }
}

function json(method, body) {
  return { method, body: JSON.stringify(body) }
}

test('authentication, tenant isolation, and business workflows use PostgreSQL', async () => {
  const health = await request('/health')
  assert.equal(health.response.status, 200)
  assert.equal(health.payload.status, 'ok')

  const alternateAllowedOrigin = allowedOrigins.find((allowedOrigin) => allowedOrigin !== origin)
  if (alternateAllowedOrigin) {
    const allowedOriginMutation = await request('/auth/logout', {
      method: 'POST',
      body: '{}',
      headers: { origin: alternateAllowedOrigin },
    })
    assert.equal(allowedOriginMutation.response.status, 401)
  }

  const config = await request('/config')
  assert.equal(config.response.status, 200)
  assert.equal(config.payload.googleClientId, process.env.GOOGLE_CLIENT_ID || null)
  const googleSignIn = await request('/auth/google', {
    ...json('POST', { credential: 'not-a-google-token' }),
  })
  assert.equal(googleSignIn.response.status, process.env.GOOGLE_CLIENT_ID ? 401 : 503)

  const setup = await request('/setup')
  assert.equal(setup.payload.setupRequired, true)

  const ownerSetup = await request('/auth/register-platform-owner', {
    ...json('POST', {
      name: 'API Test Platform Owner',
      email: 'api-test-platform-owner@example.invalid',
      password: 'api-platform-owner-password-123',
      confirmPassword: 'api-platform-owner-password-123',
      setupToken: process.env.SETUP_TOKEN,
    }),
  })
  assert.equal(ownerSetup.response.status, 201, JSON.stringify(ownerSetup.payload))
  assert.equal(ownerSetup.payload.user.role, 'platform_admin')
  const ownerCookie = ownerSetup.cookie
  assert.ok(ownerCookie)
  assert.equal((await request('/setup')).payload.setupRequired, false)

  const registration = await request('/auth/register-business', {
    ...json('POST', {
      businessName: 'API Test Business',
      ownerName: 'API Test Admin',
      email: 'api-test-admin@example.invalid',
      phone: '+255700000001',
      industry: 'Retail',
      password: 'api-test-password-123',
      confirmPassword: 'api-test-password-123',
    }),
  })
  assert.equal(registration.response.status, 202, JSON.stringify(registration.payload))
  assert.equal(registration.cookie, undefined)
  const pendingLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-test-password-123' }),
  })
  assert.equal(pendingLogin.response.status, 403)
  assert.match(pendingLogin.payload.error, /pending/i)
  const { rows: primaryRequestRows } = await ownerPool.query(
    `SELECT id FROM business_registration_requests
    WHERE email = 'api-test-admin@example.invalid' AND status = 'pending'`,
  )
  assert.equal(primaryRequestRows.length, 1)
  const primaryApplicationId = primaryRequestRows[0].id
  const platformApplications = await request('/platform/applications', { cookie: ownerCookie })
  assert.equal(platformApplications.response.status, 200)
  const primaryApplication = platformApplications.payload.applications
    .find((application) => application.id === primaryApplicationId)
  assert.equal(primaryApplication.status, 'pending')
  assert.equal(primaryApplication.businessName, 'API Test Business')

  const approveApplication = await request(`/platform/applications/${primaryApplicationId}/approve`, {
    ...json('POST', {}),
    cookie: ownerCookie,
  })
  assert.equal(approveApplication.response.status, 200, JSON.stringify(approveApplication.payload))
  primaryBusinessId = approveApplication.payload.business.id
  const adminUserId = approveApplication.payload.user.id
  assert.equal(approveApplication.payload.business.status, 'active')

  const adminLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-test-password-123' }),
  })
  assert.equal(adminLogin.response.status, 200)
  assert.equal(adminLogin.payload.user.role, 'business_admin')
  assert.equal(adminLogin.payload.user.theme, 'dark')
  assert.equal(adminLogin.payload.user.language, 'en')
  let adminCookie = adminLogin.cookie
  const restoredSession = await request('/auth/me', { cookie: adminCookie })
  assert.equal(restoredSession.response.status, 200)
  assert.equal(restoredSession.payload.user.id, adminLogin.payload.user.id)
  const savedAdminPreferences = await request('/auth/preferences', {
    ...json('PATCH', { theme: 'dark', language: 'sw' }),
    cookie: adminCookie,
  })
  assert.equal(savedAdminPreferences.response.status, 200, JSON.stringify(savedAdminPreferences.payload))
  assert.deepEqual(savedAdminPreferences.payload.preferences, { theme: 'dark', language: 'sw' })
  assert.equal((await request('/auth/me', { cookie: adminCookie })).payload.user.theme, 'dark')
  assert.equal((await request('/auth/me', { cookie: adminCookie })).payload.user.language, 'sw')
  assert.equal((await request('/auth/preferences', {
    ...json('PATCH', { theme: 'system' }),
    cookie: adminCookie,
  })).response.status, 400)
  assert.equal((await request('/auth/preferences', {
    ...json('PATCH', { role: 'platform_admin' }),
    cookie: adminCookie,
  })).response.status, 400)
  assert.equal((await request('/auth/preferences', {
    ...json('PATCH', { language: 'sw' }),
  })).response.status, 401)
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
      confirmPassword: 'api-pending-password-123',
    }),
  })
  assert.equal(pendingRegistration.response.status, 202)
  const { rows: pendingRows } = await ownerPool.query(
    `SELECT status FROM business_registration_requests WHERE email = 'api-test-pending@example.invalid'`,
  )
  assert.equal(pendingRows[0].status, 'pending')
  const pendingApplicantLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-pending@example.invalid', password: 'api-pending-password-123' }),
  })
  assert.equal(pendingApplicantLogin.response.status, 403)
  assert.match(pendingApplicantLogin.payload.error, /pending/i)

  const rejectedRegistration = await request('/auth/register-business', {
    ...json('POST', {
      businessName: 'API Test Rejected',
      ownerName: 'API Rejected Owner',
      email: 'api-test-rejected@example.invalid',
      phone: '+255700000005',
      industry: 'Services',
      password: 'api-rejected-password-123',
      confirmPassword: 'api-rejected-password-123',
    }),
  })
  assert.equal(rejectedRegistration.response.status, 202)
  const { rows: rejectedRequestRows } = await ownerPool.query(
    `SELECT id FROM business_registration_requests
    WHERE email = 'api-test-rejected@example.invalid' AND status = 'pending'`,
  )
  assert.equal(rejectedRequestRows.length, 1)
  const rejectedApplicationId = rejectedRequestRows[0].id
  const rejectApplication = await request(`/platform/applications/${rejectedApplicationId}/reject`, {
    ...json('POST', {}),
    cookie: ownerCookie,
  })
  assert.equal(rejectApplication.response.status, 200, JSON.stringify(rejectApplication.payload))
  const rejectedApplicantLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-rejected@example.invalid', password: 'api-rejected-password-123' }),
  })
  assert.equal(rejectedApplicantLogin.response.status, 403)
  assert.match(rejectedApplicantLogin.payload.error, /rejected/i)

  assert.equal((await request(`/platform/applications/${primaryApplicationId}/approve`, {
    ...json('POST', {}),
    cookie: ownerCookie,
  })).response.status, 409)
  assert.equal((await request(`/platform/applications/${rejectedApplicationId}/reject`, {
    ...json('POST', {}),
    cookie: ownerCookie,
  })).response.status, 409)
  assert.equal((await request('/platform/applications', { cookie: adminCookie })).response.status, 403)
  assert.equal((await request(`/platform/applications/${primaryApplicationId}/approve`, {
    ...json('POST', {}),
    cookie: adminCookie,
  })).response.status, 403)

  const { rows: approvalAudit } = await ownerPool.query(
    `SELECT count(*)::integer AS count FROM audit_logs
    WHERE entity_id = $1 AND action = 'platform_business_application_approved'`,
    [primaryBusinessId],
  )
  assert.equal(approvalAudit[0].count, 1)
  const { rows: rejectionAudit } = await ownerPool.query(
    `SELECT count(*)::integer AS count FROM audit_logs
    WHERE entity_id = $1 AND action = 'platform_business_application_rejected'`,
    [rejectedApplicationId],
  )
  assert.equal(rejectionAudit[0].count, 1)

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
  assert.equal(adminSale.payload.sale.tshAmount, 300)
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
  assert.equal(agentLogin.payload.user.theme, 'dark')
  assert.equal(agentLogin.payload.user.language, 'en')
  const agentCookie = agentLogin.cookie
  const agentPreferenceUpdate = await request('/auth/preferences', {
    ...json('PATCH', { language: 'sw' }),
    cookie: agentCookie,
  })
  assert.equal(agentPreferenceUpdate.response.status, 200)
  assert.equal((await request('/auth/me', { cookie: adminCookie })).payload.user.language, 'sw')
  const newAdminSession = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-test-password-123' }),
  })
  assert.equal(newAdminSession.response.status, 200)
  assert.equal(newAdminSession.payload.user.theme, 'dark')
  assert.equal(newAdminSession.payload.user.language, 'sw')
  assert.equal((await request('/dashboard', { cookie: agentCookie })).response.status, 403)
  const logoBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a2cAAAAASUVORK5CYII=',
    'base64',
  )
  assert.equal((await requestBinary('/business/logo', {
    method: 'PUT',
    body: logoBytes,
    headers: { 'content-type': 'image/png' },
  })).response.status, 401, 'logo uploads require an authenticated session')
  assert.equal((await requestBinary('/business/logo', {
    method: 'PUT',
    body: logoBytes,
    cookie: agentCookie,
    headers: { 'content-type': 'image/png' },
  })).response.status, 403, 'sales agents cannot change business branding')
  const spoofedLogo = await requestBinary('/business/logo', {
    method: 'PUT',
    body: Buffer.from('not an image'),
    cookie: adminCookie,
    headers: { 'content-type': 'image/png' },
  })
  assert.equal(spoofedLogo.response.status, 400, 'logo uploads validate the image signature')
  const savedLogo = await requestBinary('/business/logo', {
    method: 'PUT',
    body: logoBytes,
    cookie: adminCookie,
    headers: { 'content-type': 'image/png' },
  })
  assert.equal(savedLogo.response.status, 200, JSON.stringify(savedLogo.payload))
  assert.ok(savedLogo.payload.logoUpdatedAt)
  const adminLogo = await requestBinary('/business/logo', { cookie: adminCookie })
  assert.equal(adminLogo.response.headers.get('content-type'), 'image/png')
  assert.deepEqual(adminLogo.payload, logoBytes)
  const agentLogo = await requestBinary('/business/logo', { cookie: agentCookie })
  assert.equal(agentLogo.response.status, 200, 'sales agents can see their business logo')
  assert.deepEqual(agentLogo.payload, logoBytes)
  const oversizedLogo = await requestBinary('/business/logo', {
    method: 'PUT',
    body: Buffer.alloc(5 * 1024 * 1024 + 1),
    cookie: adminCookie,
    headers: { 'content-type': 'image/png' },
  })
  assert.equal(oversizedLogo.response.status, 413, 'logo uploads are limited to 5 MB')
  assert.match(oversizedLogo.payload.error, /5 MB/)
  const removedLogo = await request('/business/logo', { method: 'DELETE', cookie: adminCookie })
  assert.equal(removedLogo.response.status, 204)
  assert.equal((await requestBinary('/business/logo', { cookie: agentCookie })).response.status, 404)
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
  assert.equal(dashboard.payload.metrics.netProfit, 125)
  assert.equal(dashboard.payload.metrics.cashFlow, 425)
  const initialCashFlow = dashboard.payload.metrics.cashFlow
  assert.equal(dashboard.payload.metrics.todayExpenses, 25)
  assert.equal(dashboard.payload.metrics.productsSold, 3)
  assert.equal(dashboard.payload.metrics.inventoryValue, 700)
  assert.equal(dashboard.payload.chart.length, 1)
  assert.ok(dashboard.payload.expenseBreakdown.some((row) => row.category === savedExpense.category))
  assert.ok(dashboard.payload.recentTransactions.some((row) => row.category === savedExpense.category))
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
  const sevenDayChart = await request(`/dashboard?range=7days&date=${today}`, { cookie: adminCookie })
  const thirtyDayChart = await request(`/dashboard?range=30days&date=${today}`, { cookie: adminCookie })
  const ninetyDayChart = await request(`/dashboard?range=90days&date=${today}`, { cookie: adminCookie })
  const customChart = await request(`/dashboard?range=custom&date=${today}&startDate=${today}&endDate=${today}`, { cookie: adminCookie })
  const quarterChart = await request(`/dashboard?range=3months&date=${today}`, { cookie: adminCookie })
  const yearChart = await request(`/dashboard?range=year&date=${today}`, { cookie: adminCookie })
  const selectedDateChart = await request(`/dashboard?range=day&date=${today}`, { cookie: adminCookie })
  const invalidChartDate = await request('/dashboard?range=day&date=2026-02-30', { cookie: adminCookie })
  const reversedCustomRange = await request(`/dashboard?range=custom&date=${today}&startDate=${today}&endDate=2000-01-01`, { cookie: adminCookie })
  assert.equal(weekChart.payload.chart.length, 7)
  assert.equal(sevenDayChart.payload.chart.length, 7)
  assert.equal(thirtyDayChart.payload.chart.length, 30)
  assert.equal(ninetyDayChart.payload.chart.length, 90)
  assert.equal(customChart.payload.chart.length, 1)
  assert.ok(quarterChart.payload.chart.length >= 89 && quarterChart.payload.chart.length <= 92)
  assert.equal(yearChart.payload.chart.length, 12)
  assert.equal(selectedDateChart.payload.chart.length, 1)
  assert.equal(invalidChartDate.response.status, 400)
  assert.equal(reversedCustomRange.response.status, 400)

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

  // ---------------------------------------------------------------------------
  // Customer Debts (Credit Sales) module
  // ---------------------------------------------------------------------------
  const registerCustomer = await request('/customers', {
    ...json('POST', { name: 'Ada Debtor', phone: '+255700000090', address: 'Kariakoo' }),
    cookie: adminCookie,
  })
  assert.equal(registerCustomer.response.status, 201, JSON.stringify(registerCustomer.payload))
  const customer = registerCustomer.payload.customer
  assert.equal(customer.name, 'Ada Debtor')
  assert.equal(customer.totalDebt, 0)
  assert.equal(customer.debtStatus, 'unpaid')

  const agentRegisterCustomer = await request('/customers', {
    ...json('POST', { name: 'Agent Customer', phone: '+255700000091' }),
    cookie: agentCookie,
  })
  assert.equal(agentRegisterCustomer.response.status, 201, JSON.stringify(agentRegisterCustomer.payload))
  assert.equal(agentRegisterCustomer.payload.customer.name, 'Agent Customer')
  assert.equal(agentRegisterCustomer.payload.customer.totalDebt, 0)
  const { rows: agentCustomerRecord } = await ownerPool.query(
    `SELECT business_id FROM customers WHERE id = $1`,
    [agentRegisterCustomer.payload.customer.id],
  )
  assert.equal(agentCustomerRecord[0].business_id, primaryBusinessId)
  const { rows: agentCustomerAudit } = await ownerPool.query(
    `SELECT actor_user_id FROM audit_logs
    WHERE business_id = $1 AND entity_id = $2 AND action = 'customer_created'`,
    [primaryBusinessId, agentRegisterCustomer.payload.customer.id],
  )
  assert.equal(agentCustomerAudit[0].actor_user_id, agent.id)

  const duplicateCustomer = await request('/customers', {
    ...json('POST', { name: 'Ada Debtor', phone: '+255700000090' }),
    cookie: adminCookie,
  })
  assert.equal(duplicateCustomer.response.status, 409, 'duplicate customer profiles are rejected')

  const customersList = await request('/customers', { cookie: adminCookie })
  assert.equal(customersList.response.status, 200)
  assert.equal(customersList.payload.customers.length, 2)
  assert.ok(customersList.payload.customers.every((listedCustomer) => listedCustomer.debtStatus === 'unpaid'))
  assert.equal((await request('/customers?search=Ada', { cookie: adminCookie })).payload.customers.length, 1)
  assert.equal((await request('/customers?search=+255700000090', { cookie: adminCookie })).payload.customers.length, 1)
  assert.equal((await request('/customers?search=NoOne', { cookie: adminCookie })).payload.customers.length, 0)
  assert.equal((await request('/customers?status=paid', { cookie: adminCookie })).payload.customers.length, 0)
  assert.equal((await request('/customers?status=bogus', { cookie: adminCookie })).response.status, 400)

  const firstDebt = await request(`/customers/${customer.id}/debt`, {
    ...json('POST', { items: [{ productId, quantity: 2 }] }),
    cookie: adminCookie,
  })
  assert.equal(firstDebt.response.status, 201, JSON.stringify(firstDebt.payload))
  assert.equal(firstDebt.payload.customer.totalDebt, 300)
  assert.equal(firstDebt.payload.customer.amountPaid, 0)
  assert.equal(firstDebt.payload.customer.balance, 300)
  assert.equal(firstDebt.payload.customer.debtStatus, 'unpaid')
  assert.equal(firstDebt.payload.customer.transactions.length, 1)
  assert.equal(firstDebt.payload.customer.transactions[0].quantity, 2)
  assert.equal(firstDebt.payload.customer.transactions[0].unitPrice, 150)
  assert.ok(firstDebt.payload.creditSale.receiptNumber)
  const { rows: stockAfterDebt } = await ownerPool.query(
    'SELECT quantity FROM products WHERE business_id = $1 AND id = $2',
    [primaryBusinessId, productId],
  )
  assert.equal(stockAfterDebt[0].quantity, 5, 'stock is deducted once when goods are issued on credit')
  const { rows: creditSales } = await ownerPool.query(
    `SELECT s.payment_status, s.customer_name FROM sales s
     JOIN debt_transactions dt ON dt.business_id = s.business_id AND dt.sale_id = s.id
     WHERE s.business_id = $1 AND s.id = $2`,
    [primaryBusinessId, firstDebt.payload.creditSale.id],
  )
  assert.equal(creditSales[0].payment_status, 'unpaid', 'credit sales are recorded, not cash sales')
  assert.equal(creditSales[0].customer_name, 'Ada Debtor')
  assert.equal((await request('/dashboard', { cookie: adminCookie })).payload.metrics.cashFlow, initialCashFlow)
  const { rows: debtMovements } = await ownerPool.query(
    `SELECT movement_type, quantity_change FROM stock_movements
     WHERE business_id = $1 AND product_id = $2 AND note LIKE 'Credit sale %'`,
    [primaryBusinessId, productId],
  )
  assert.equal(debtMovements.length, 1)
  assert.equal(debtMovements[0].movement_type, 'sale')
  assert.equal(debtMovements[0].quantity_change, -2)

  const overStockDebt = await request(`/customers/${customer.id}/debt`, {
    ...json('POST', { items: [{ productId, quantity: 999 }] }),
    cookie: adminCookie,
  })
  assert.equal(overStockDebt.response.status, 409, 'negative stock is prevented on credit sales')

  const manualDebt = await request(`/customers/${customer.id}/debt`, {
    ...json('POST', { items: [{ productName: 'Service charge', quantity: 1, unitPrice: 50 }] }),
    cookie: adminCookie,
  })
  assert.equal(manualDebt.response.status, 201, JSON.stringify(manualDebt.payload))
  assert.equal(manualDebt.payload.customer.totalDebt, 350)
  assert.equal(manualDebt.payload.customer.debtStatus, 'unpaid')
  const { rows: stockAfterManual } = await ownerPool.query(
    'SELECT quantity FROM products WHERE business_id = $1 AND id = $2',
    [primaryBusinessId, productId],
  )
  assert.equal(stockAfterManual[0].quantity, 5, 'manual items do not touch inventory stock')

  const payment = await request(`/customers/${customer.id}/payments`, {
    ...json('POST', { amount: 100, clientReference: 'PAY-ADEBT-1' }),
    cookie: adminCookie,
  })
  assert.equal(payment.response.status, 201, JSON.stringify(payment.payload))
  assert.equal(payment.payload.customer.amountPaid, 100)
  assert.equal(payment.payload.customer.balance, 250)
  assert.equal(payment.payload.customer.debtStatus, 'partial')

  const overPayment = await request(`/customers/${customer.id}/payments`, {
    ...json('POST', { amount: 300, clientReference: 'PAY-ADEBT-2' }),
    cookie: adminCookie,
  })
  assert.equal(overPayment.response.status, 409, 'payments may not exceed the outstanding balance')

  const duplicatePayment = await request(`/customers/${customer.id}/payments`, {
    ...json('POST', { amount: 100, clientReference: 'PAY-ADEBT-1' }),
    cookie: adminCookie,
  })
  assert.equal(duplicatePayment.response.status, 200)
  assert.equal(duplicatePayment.payload.duplicate, true, 're-submitting the same payment reference never double-records')

  const agentPayment = await request(`/customers/${customer.id}/payments`, {
    ...json('POST', { amount: 50, clientReference: 'PAY-ADEBT-3' }),
    cookie: agentCookie,
  })
  assert.equal(agentPayment.response.status, 201, 'sales agents may record debt payments')
  assert.equal((await request('/dashboard', { cookie: adminCookie })).payload.metrics.cashFlow, initialCashFlow + 150)

  const customerDetail = await request(`/customers/${customer.id}`, { cookie: agentCookie })
  assert.equal(customerDetail.response.status, 200)
  assert.equal(customerDetail.payload.customer.transactions.length, 2)
  assert.equal(customerDetail.payload.customer.payments.length, 2, 'payment history is preserved')
  assert.equal(customerDetail.payload.customer.amountPaid, 150)
  assert.equal(customerDetail.payload.customer.balance, 200)

  const report = await request('/customers/report', { cookie: adminCookie })
  assert.equal(report.response.status, 200)
  assert.equal(report.payload.summary.customers, 2)
  assert.equal(report.payload.summary.totalDebt, 350)
  assert.equal(report.payload.summary.totalCollected, 150)
  assert.ok(Math.abs(report.payload.summary.totalOutstanding - 200) < 0.005)
  assert.equal(report.payload.summary.byStatus.partial, 1)

  const agentCorrectionDenied = await request(
    `/customers/${customer.id}/transactions/${firstDebt.payload.createdTransactionIds[0]}`,
    { ...json('PATCH', { quantity: 3 }), cookie: agentCookie },
  )
  assert.equal(agentCorrectionDenied.response.status, 403, 'only business admins may correct debt lines')

  const correction = await request(
    `/customers/${customer.id}/transactions/${firstDebt.payload.createdTransactionIds[0]}`,
    { ...json('PATCH', { quantity: 3 }), cookie: adminCookie },
  )
  assert.equal(correction.response.status, 200, JSON.stringify(correction.payload))
  assert.equal(correction.payload.customer.totalDebt, 500)
  const { rows: stockAfterCorrection } = await ownerPool.query(
    'SELECT quantity FROM products WHERE business_id = $1 AND id = $2',
    [primaryBusinessId, productId],
  )
  assert.equal(stockAfterCorrection[0].quantity, 4, 'increasing a credit line deducts the extra stock')

  const voidLine = await request(
    `/customers/${customer.id}/transactions/${manualDebt.payload.createdTransactionIds[0]}`,
    { ...json('DELETE', {}), cookie: adminCookie },
  )
  assert.equal(voidLine.response.status, 200, JSON.stringify(voidLine.payload))
  assert.equal(voidLine.payload.customer.totalDebt, 450)
  assert.equal(voidLine.payload.customer.debtStatus, 'partial')
  const { rows: stockAfterVoidLine } = await ownerPool.query(
    'SELECT quantity FROM products WHERE business_id = $1 AND id = $2',
    [primaryBusinessId, productId],
  )
  assert.equal(stockAfterVoidLine[0].quantity, 4, 'voiding a manual line leaves inventory untouched')

  const finalPayment = await request(`/customers/${customer.id}/payments`, {
    ...json('POST', { amount: 300, clientReference: 'PAY-ADEBT-4' }),
    cookie: adminCookie,
  })
  assert.equal(finalPayment.response.status, 201, JSON.stringify(finalPayment.payload))
  assert.equal(finalPayment.payload.customer.amountPaid, 450)
  assert.equal(finalPayment.payload.customer.balance, 0)
  assert.equal(finalPayment.payload.customer.debtStatus, 'paid')
  assert.equal((await request('/dashboard', { cookie: adminCookie })).payload.metrics.cashFlow, initialCashFlow + 450)
  const { rows: salesAfterFullPayment } = await ownerPool.query(
    `SELECT s.payment_status FROM sales s
     JOIN debt_transactions dt ON dt.business_id = s.business_id AND dt.sale_id = s.id
     WHERE s.business_id = $1 AND s.id = $2 GROUP BY s.id`,
    [primaryBusinessId, firstDebt.payload.creditSale.id],
  )
  assert.equal(salesAfterFullPayment[0].payment_status, 'paid', 'credit sales flip to paid when the debt is settled')

  const blockedVoid = await request(
    `/customers/${customer.id}/transactions/${firstDebt.payload.createdTransactionIds[0]}`,
    { ...json('DELETE', {}), cookie: adminCookie },
  )
  assert.equal(blockedVoid.response.status, 409, 'voiding a fully-paid line is blocked to protect payment history')

  const customerPatch = await request(`/customers/${customer.id}`, {
    ...json('PATCH', { address: 'Mchikichini' }),
    cookie: adminCookie,
  })
  assert.equal(customerPatch.response.status, 200, JSON.stringify(customerPatch.payload))
  assert.equal(customerPatch.payload.customer.address, 'Mchikichini')
  assert.equal((await request(`/customers/${customer.id}`, {
    ...json('PATCH', { address: 'X' }),
    cookie: agentCookie,
  })).response.status, 403, 'sales agents may not edit customer profiles')

  const deleteCustomer = await request(`/customers/${customer.id}`, {
    ...json('DELETE', {}),
    cookie: adminCookie,
  })
  assert.equal(deleteCustomer.response.status, 204)
  assert.equal((await request('/customers', { cookie: adminCookie })).payload.customers.length, 1,
    'deleting the admin-created customer leaves the agent-created customer intact')
  const { rows: stockAfterCustomerDelete } = await ownerPool.query(
    'SELECT quantity FROM products WHERE business_id = $1 AND id = $2',
    [primaryBusinessId, productId],
  )
  assert.equal(stockAfterCustomerDelete[0].quantity, 7, 'deleting a customer returns inventory goods to stock')
  const { rows: voidedCreditSales } = await ownerPool.query(
    'SELECT status, payment_status FROM sales WHERE business_id = $1 AND id = $2',
    [primaryBusinessId, firstDebt.payload.creditSale.id],
  )
  assert.equal(voidedCreditSales[0].status, 'voided')
  assert.equal(voidedCreditSales[0].payment_status, 'refunded')
  const { rows: debtAudit } = await ownerPool.query(
    `SELECT action, count(*)::integer AS count FROM audit_logs
     WHERE business_id = $1 GROUP BY action`,
    [primaryBusinessId],
  )
  const auditActions = Object.fromEntries(debtAudit.map((row) => [row.action, row.count]))
  assert.equal(auditActions.customer_created, 2)
  assert.ok(auditActions.debt_transaction_created >= 2)
  assert.equal(auditActions.debt_payment_recorded, 3)
  assert.equal(auditActions.debt_transaction_updated, 1)
  assert.equal(auditActions.debt_transaction_voided, 1)
  assert.equal(auditActions.customer_updated, 1)
  assert.equal(auditActions.customer_deleted, 1)

  const agentExpense = await request('/expenses', {
    ...json('POST', {
      category: 'Agent expense',
      description: 'Sales agent recorded travel cost',
      amount: 12.5,
    }),
    cookie: agentCookie,
  })
  assert.equal(agentExpense.response.status, 201, JSON.stringify(agentExpense.payload))
  assert.equal(agentExpense.payload.expense.category, 'Agent expense')
  const { rows: savedAgentExpense } = await ownerPool.query(
    'SELECT business_id, recorded_by, amount FROM expenses WHERE id = $1',
    [agentExpense.payload.expense.id],
  )
  assert.equal(savedAgentExpense[0].business_id, primaryBusinessId)
  assert.equal(savedAgentExpense[0].recorded_by, agent.id)
  assert.equal(savedAgentExpense[0].amount, '12.50')
  assert.equal((await request('/expenses', { cookie: agentCookie })).response.status, 403,
    'agents can record expenses without access to the administrator expense list')

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
  await ownerPool.query(
    `INSERT INTO business_registration_requests
      (business_name, owner_name, email, phone, industry, password_hash, status, reviewed_at)
    VALUES ('API Test Secondary', 'Secondary Admin', $1, '+255700000003', 'Retail', $2, 'approved', now())`,
    [secondaryName, secondaryPasswordHash],
  )
  const { rows: secondarySubscriptions } = await ownerPool.query(
    `INSERT INTO subscriptions
      (business_id, plan_id, status, current_period_end, current_period_amount, current_period_currency)
    SELECT $1, id, 'active', now() + interval '1 month', price, currency
    FROM subscription_plans WHERE name = 'Business Growth'
    RETURNING id, current_period_start, current_period_end, current_period_currency`,
    [secondaryBusinessId],
  )
  await ownerPool.query(
    `INSERT INTO payments
      (business_id, subscription_id, amount, currency, payment_method, status,
        subscription_period_start, subscription_period_end)
    VALUES ($1, $2, 1000, $3, 'cash', 'pending', $4, $5)`,
    [
      secondaryBusinessId,
      secondarySubscriptions[0].id,
      secondarySubscriptions[0].current_period_currency,
      secondarySubscriptions[0].current_period_start,
      secondarySubscriptions[0].current_period_end,
    ],
  )
  const isolatedProducts = await request('/products', { cookie: secondaryLogin.cookie })
  assert.equal(isolatedProducts.response.status, 200)
  assert.equal(isolatedProducts.payload.products.length, 0)

  const isolatedCustomers = await request('/customers', { cookie: secondaryLogin.cookie })
  assert.equal(isolatedCustomers.response.status, 200)
  assert.equal(isolatedCustomers.payload.customers.length, 0, 'a fresh business starts with no debtors')
  await ownerPool.query(
    `INSERT INTO customers (business_id, name, phone) VALUES ($1, 'Secondary Debtor', '+255700000099')`,
    [secondaryBusinessId],
  )
  const secondaryCustomersVisible = await request('/customers', { cookie: secondaryLogin.cookie })
  assert.equal(secondaryCustomersVisible.payload.customers.length, 1)
  const primaryCustomersStillIsolated = await request('/customers', { cookie: adminCookie })
  assert.equal(primaryCustomersStillIsolated.payload.customers.length, 1)
  assert.equal(primaryCustomersStillIsolated.payload.customers[0].name, 'Agent Customer',
    'agent-created customers stay in their business and are never visible to another tenant')

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
  assert.equal(
    platformBusinesses.payload.businesses.find((business) => business.id === primaryBusinessId).ownerUserId,
    adminUserId,
  )
  assert.equal((await request('/platform/businesses', { cookie: adminCookie })).response.status, 403)
  assert.equal((await request(`/platform/businesses/${primaryBusinessId}`, {
    ...json('PATCH', { status: 'suspended', reason: 'unauthorized test' }),
    cookie: adminCookie,
  })).response.status, 403)

  const initialSettings = await request('/platform/subscription-settings', { cookie: ownerCookie })
  assert.equal(initialSettings.response.status, 200)
  assert.equal(initialSettings.payload.settings.monthlyFee, 199000)
  assert.equal(initialSettings.payload.settings.currency, 'TZS')
  assert.equal(initialSettings.payload.settings.graceDays, 0)
  assert.equal((await request('/platform/subscription-settings', { cookie: adminCookie })).response.status, 403)

  const updatedSettings = await request('/platform/subscription-settings', {
    ...json('POST', { monthlyFee: 240000, currency: 'TZS', graceDays: 7 }),
    cookie: ownerCookie,
  })
  assert.equal(updatedSettings.response.status, 200, JSON.stringify(updatedSettings.payload))
  assert.equal(updatedSettings.payload.settings.monthlyFee, 240000)
  assert.equal(updatedSettings.payload.settings.graceDays, 7)
  assert.equal((await request('/platform/subscription-settings', {
    ...json('POST', { monthlyFee: 0, currency: 'TZS', graceDays: 0 }),
    cookie: ownerCookie,
  })).response.status, 400)
  assert.equal((await request('/platform/subscription-settings', {
    ...json('POST', { monthlyFee: 240000, currency: 'XYZ', graceDays: 0 }),
    cookie: ownerCookie,
  })).response.status, 400)
  assert.equal((await request('/platform/subscription-settings', {
    ...json('POST', { monthlyFee: 240000, currency: 'TZS', graceDays: -1 }),
    cookie: ownerCookie,
  })).response.status, 400)
  assert.equal((await request('/platform/subscription-settings', {
    ...json('POST', { monthlyFee: 240000, currency: 'TZS', graceDays: 7 }),
    cookie: adminCookie,
  })).response.status, 403)

  const billingBusinesses = await request('/platform/businesses', { cookie: ownerCookie })
  const billingPrimary = billingBusinesses.payload.businesses
    .find((business) => business.id === primaryBusinessId)
  assert.equal(billingPrimary.fee, 199000, 'Updating the plan must not change the current subscription invoice.')
  assert.equal(billingPrimary.feeCurrency, 'TZS')
  assert.equal(billingPrimary.approvalStatus, 'approved')
  assert.equal(billingPrimary.paymentStatus, 'paid')
  assert.equal(billingPrimary.outstandingBalance, 0)
  assert.ok(billingPrimary.dueDate)
  assert.equal(billingPrimary.suspendedReason, null)
  assert.equal(billingPrimary.pendingPayment, null)

  const recordedPayment = await request(`/platform/businesses/${primaryBusinessId}/payments`, {
    ...json('POST', { amount: 199000, currency: 'TZS', method: 'mobile_money', reference: 'API-REF-001' }),
    cookie: ownerCookie,
  })
  assert.equal(recordedPayment.response.status, 200, JSON.stringify(recordedPayment.payload))
  assert.equal(recordedPayment.payload.payment.status, 'pending')
  assert.equal((await request(`/platform/businesses/${primaryBusinessId}/payments`, {
    ...json('POST', { amount: 240000, currency: 'TZS', method: 'mobile_money' }),
    cookie: adminCookie,
  })).response.status, 403)
  assert.equal((await request(`/platform/businesses/${primaryBusinessId}/payments`, {
    ...json('POST', { amount: 199000, currency: 'TZS', method: 'unsupported' }),
    cookie: ownerCookie,
  })).response.status, 400)
  const pendingPaymentId = recordedPayment.payload.payment.id
  const pendingBusiness = (await request('/platform/businesses', { cookie: ownerCookie }))
    .payload.businesses.find((business) => business.id === primaryBusinessId)
  assert.equal(pendingBusiness.paymentStatus, 'pending')
  assert.equal(pendingBusiness.pendingPayment.id, pendingPaymentId)
  assert.equal(pendingBusiness.pendingPayment.amount, 199000)
  assert.equal((await request(`/platform/businesses/${primaryBusinessId}/payments`, {
    ...json('POST', { amount: 1, currency: 'USD', method: 'mobile_money' }),
    cookie: ownerCookie,
  })).response.status, 400)
  assert.equal((await request(`/platform/businesses/${primaryBusinessId}/payments`, {
    ...json('POST', { amount: 1, currency: 'TZS', method: 'mobile_money' }),
    cookie: ownerCookie,
  })).response.status, 400)
  assert.equal((await request(`/platform/payments/${pendingPaymentId}/verify`, {
    ...json('POST', {}),
    cookie: adminCookie,
  })).response.status, 403)

  const verifiedPayment = await request(`/platform/payments/${pendingPaymentId}/verify`, {
    ...json('POST', {}),
    cookie: ownerCookie,
  })
  assert.equal(verifiedPayment.response.status, 200, JSON.stringify(verifiedPayment.payload))
  assert.equal(verifiedPayment.payload.payment.status, 'succeeded')
  const paidBusiness = (await request('/platform/businesses', { cookie: ownerCookie }))
    .payload.businesses.find((business) => business.id === primaryBusinessId)
  assert.equal(paidBusiness.paymentStatus, 'paid')
  assert.equal(paidBusiness.fee, 240000, 'The next billing period must use the current subscription fee.')
  assert.equal(paidBusiness.pendingPayment, null)
  const { rows: savedPayment } = await ownerPool.query(
    `SELECT status, paid_at, provider_reference, currency FROM payments WHERE business_id = $1 AND id = $2`,
    [primaryBusinessId, pendingPaymentId],
  )
  assert.equal(savedPayment[0].status, 'succeeded')
  assert.equal(savedPayment[0].provider_reference, 'API-REF-001')
  assert.equal(savedPayment[0].currency, 'TZS')
  assert.ok(savedPayment[0].paid_at)
  assert.equal((await request(`/platform/payments/${pendingPaymentId}/verify`, {
    ...json('POST', {}),
    cookie: ownerCookie,
  })).response.status, 409)

  await ownerPool.query(
    `UPDATE subscriptions SET current_period_start = now() - interval '1 month',
      current_period_end = now() - interval '8 days'
    WHERE business_id = $1`,
    [primaryBusinessId],
  )
  const overdueBusiness = (await request('/platform/businesses', { cookie: ownerCookie }))
    .payload.businesses.find((business) => business.id === primaryBusinessId)
  assert.equal(overdueBusiness.paymentStatus, 'overdue')
  assert.equal(overdueBusiness.outstandingBalance, 240000)

  const partialPayment = await request(`/platform/businesses/${primaryBusinessId}/payments`, {
    ...json('POST', { amount: 100000, currency: 'TZS', method: 'bank_transfer', reference: 'API-REF-PARTIAL' }),
    cookie: ownerCookie,
  })
  assert.equal(partialPayment.response.status, 200, JSON.stringify(partialPayment.payload))
  const pendingOverdueBusiness = (await request('/platform/businesses', { cookie: ownerCookie }))
    .payload.businesses.find((business) => business.id === primaryBusinessId)
  assert.equal(pendingOverdueBusiness.paymentStatus, 'overdue')
  assert.equal(pendingOverdueBusiness.pendingPayment.id, partialPayment.payload.payment.id)
  const verifyPartialPayment = await request(`/platform/payments/${partialPayment.payload.payment.id}/verify`, {
    ...json('POST', {}),
    cookie: ownerCookie,
  })
  assert.equal(verifyPartialPayment.response.status, 200, JSON.stringify(verifyPartialPayment.payload))
  const { rows: partialPaymentSnapshot } = await ownerPool.query(
    `SELECT pay.status, pay.subscription_period_start, pay.subscription_period_end,
      s.current_period_start, s.current_period_end,
      pay.subscription_period_start = s.current_period_start
        AND pay.subscription_period_end = s.current_period_end AS matches_period
    FROM payments pay JOIN subscriptions s ON s.id = pay.subscription_id
    WHERE pay.id = $1`,
    [partialPayment.payload.payment.id],
  )
  assert.equal(partialPaymentSnapshot[0].matches_period, true, JSON.stringify(partialPaymentSnapshot[0]))
  const partiallyPaidBusiness = (await request('/platform/businesses', { cookie: ownerCookie }))
    .payload.businesses.find((business) => business.id === primaryBusinessId)
  assert.equal(partiallyPaidBusiness.paymentStatus, 'overdue')
  assert.equal(partiallyPaidBusiness.outstandingBalance, 140000)

  const remainingPayment = await request(`/platform/businesses/${primaryBusinessId}/payments`, {
    ...json('POST', { amount: 140000, currency: 'TZS', method: 'bank_transfer', reference: 'API-REF-REMAINDER' }),
    cookie: ownerCookie,
  })
  assert.equal(remainingPayment.response.status, 200, JSON.stringify(remainingPayment.payload))
  const verifyRemainingPayment = await request(`/platform/payments/${remainingPayment.payload.payment.id}/verify`, {
    ...json('POST', {}),
    cookie: ownerCookie,
  })
  assert.equal(verifyRemainingPayment.response.status, 200, JSON.stringify(verifyRemainingPayment.payload))
  assert.equal(verifyRemainingPayment.payload.payment.periodExtended, true)
  const fullyPaidBusiness = (await request('/platform/businesses', { cookie: ownerCookie }))
    .payload.businesses.find((business) => business.id === primaryBusinessId)
  assert.equal(fullyPaidBusiness.paymentStatus, 'paid')
  assert.equal(fullyPaidBusiness.outstandingBalance, 0)
  assert.equal(fullyPaidBusiness.fee, 240000)

  const suspendWithReason = await request(`/platform/businesses/${primaryBusinessId}`, {
    ...json('PATCH', { status: 'suspended', reason: 'missed subscription payment' }),
    cookie: ownerCookie,
  })
  assert.equal(suspendWithReason.response.status, 200, JSON.stringify(suspendWithReason.payload))
  const suspendedBusiness = (await request('/platform/businesses', { cookie: ownerCookie }))
    .payload.businesses.find((business) => business.id === primaryBusinessId)
  assert.equal(suspendedBusiness.status, 'suspended')
  assert.equal(suspendedBusiness.suspendedReason, 'missed subscription payment')
  assert.ok(suspendedBusiness.suspendedAt)
  assert.equal(suspendedBusiness.paymentStatus, 'suspended')
  const reactivateAfterSuspension = await request(`/platform/businesses/${primaryBusinessId}`, {
    ...json('PATCH', { status: 'active' }),
    cookie: ownerCookie,
  })
  assert.equal(reactivateAfterSuspension.response.status, 200)
  const reactivatedBusiness = (await request('/platform/businesses', { cookie: ownerCookie }))
    .payload.businesses.find((business) => business.id === primaryBusinessId)
  assert.equal(reactivatedBusiness.status, 'active')
  assert.equal(reactivatedBusiness.suspendedReason, null)
  assert.equal(reactivatedBusiness.suspendedAt, null)

  const { rows: settingsAudit } = await ownerPool.query(
    `SELECT count(*)::integer AS count FROM audit_logs
    WHERE action = 'platform_subscription_settings_updated'`,
  )
  assert.equal(settingsAudit[0].count, 1)
  const { rows: suspensionAudit } = await ownerPool.query(
    `SELECT details FROM audit_logs
    WHERE entity_id = $1 AND action = 'platform_business_suspended'
    ORDER BY created_at DESC LIMIT 1`,
    [primaryBusinessId],
  )
  assert.equal(suspensionAudit[0].details.reason, 'missed subscription payment')
  const { rows: paymentAudit } = await ownerPool.query(
    `SELECT action, count(*)::integer AS count FROM audit_logs
    WHERE entity_id = $1 AND action IN ('platform_payment_recorded', 'platform_payment_verified')
    GROUP BY action`,
    [pendingPaymentId],
  )
  assert.equal(paymentAudit.length, 2)
  assert.ok(paymentAudit.some((row) => row.action === 'platform_payment_recorded' && row.count === 1))
  assert.ok(paymentAudit.some((row) => row.action === 'platform_payment_verified' && row.count === 1))

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
  assert.equal(suspendBusiness.response.status, 400)
  const suspendBusinessWithReason = await request(`/platform/businesses/${primaryBusinessId}`, {
    ...json('PATCH', { status: 'suspended', reason: 'account access test' }),
    cookie: ownerCookie,
  })
  assert.equal(suspendBusinessWithReason.response.status, 200)
  assert.equal(suspendBusinessWithReason.payload.business.status, 'suspended')
  assert.equal((await request('/auth/me', { cookie: adminCookie })).response.status, 401)
  const suspendedLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-test-password-123' }),
  })
  assert.equal(suspendedLogin.response.status, 403)

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
      (SELECT count(*)::integer FROM subscriptions WHERE business_id = $1) AS subscriptions,
      (SELECT count(*)::integer FROM payments WHERE business_id = $1) AS payments,
      (SELECT count(*)::integer FROM customers WHERE business_id = $1) AS customers,
      (SELECT count(*)::integer FROM debt_transactions WHERE business_id = $1) AS debt_transactions,
      (SELECT count(*)::integer FROM debt_payments WHERE business_id = $1) AS debt_payments,
      (SELECT count(*)::integer FROM auth_sessions WHERE user_id IN
        (SELECT id FROM users WHERE business_id = $1)) AS auth_sessions,
      (SELECT count(*)::integer FROM audit_logs WHERE business_id IS NULL AND entity_id = $1
        AND action = 'platform_business_deleted') AS deletion_audit,
      (SELECT count(*)::integer FROM business_registration_requests WHERE lower(email) = lower($2)) AS registration_records`,
    [secondaryBusinessId, secondaryName],
  )
  assert.deepEqual(deletedBusinessData.rows[0], {
    businesses: 0,
    users: 0,
    categories: 0,
    products: 0,
    sales: 0,
    sale_items: 0,
    expenses: 0,
    subscriptions: 0,
    payments: 0,
    customers: 0,
    debt_transactions: 0,
    debt_payments: 0,
    auth_sessions: 0,
    deletion_audit: 1,
    registration_records: 0,
  })
  assert.equal((await request('/auth/me', { cookie: secondaryLogin.cookie })).response.status, 401)
  assert.equal((await request('/auth/login', {
    ...json('POST', { email: secondaryName, password: 'api-secondary-password-123' }),
  })).response.status, 401)

  const rejectedOwnerReset = await request(`/platform/users/${adminUserId}/password`, {
    ...json('PATCH', { ownerPassword: 'incorrect-owner-password', password: 'api-admin-password-456', confirmPassword: 'api-admin-password-456' }),
    cookie: ownerCookie,
  })
  assert.equal(rejectedOwnerReset.response.status, 403)

  const ownerResetsAdmin = await request(`/platform/users/${adminUserId}/password`, {
    ...json('PATCH', { ownerPassword: 'api-platform-owner-password-123', password: 'api-admin-password-456', confirmPassword: 'api-admin-password-456' }),
    cookie: ownerCookie,
  })
  assert.equal(ownerResetsAdmin.response.status, 204, JSON.stringify(ownerResetsAdmin.payload))
  assert.equal((await request('/auth/me', { cookie: adminCookie })).response.status, 401)
  const staleAdminLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-test-password-123' }),
  })
  assert.equal(staleAdminLogin.response.status, 401)
  const adminAfterReset = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-admin-password-456' }),
  })
  assert.equal(adminAfterReset.response.status, 200)
  adminCookie = adminAfterReset.cookie
  const { rows: resetAudit } = await ownerPool.query(
    `SELECT count(*)::integer AS count FROM audit_logs
    WHERE entity_id = $1 AND action = 'platform_business_admin_password_reset'`,
    [adminUserId],
  )
  assert.equal(resetAudit[0].count, 1)

  const preResetAgentLogin = await request('/auth/login', {
    ...json('POST', { email: agent.email, password: 'api-agent-password-123' }),
  })
  assert.equal(preResetAgentLogin.response.status, 200)
  const preResetAgentCookie = preResetAgentLogin.cookie
  const rejectedAgentReset = await request(`/staff/${agent.id}/password`, {
    ...json('PATCH', { password: 'api-agent-password-456', confirmPassword: 'api-agent-password-456' }),
    cookie: preResetAgentCookie,
  })
  assert.equal(rejectedAgentReset.response.status, 403)
  assert.equal((await request(`/platform/users/${adminUserId}/password`, {
    ...json('PATCH', { ownerPassword: 'api-platform-owner-password-123', password: 'api-admin-password-456', confirmPassword: 'api-admin-password-456' }),
    cookie: preResetAgentCookie,
  })).response.status, 403)
  const mismatchedAgentReset = await request(`/staff/${agent.id}/password`, {
    ...json('PATCH', { password: 'api-agent-password-456', confirmPassword: 'api-agent-password-000' }),
    cookie: adminCookie,
  })
  assert.equal(mismatchedAgentReset.response.status, 400)
  const agentPasswordReset = await request(`/staff/${agent.id}/password`, {
    ...json('PATCH', { password: 'api-agent-password-456', confirmPassword: 'api-agent-password-456' }),
    cookie: adminCookie,
  })
  assert.equal(agentPasswordReset.response.status, 204)
  assert.equal((await request('/auth/me', { cookie: preResetAgentCookie })).response.status, 401)
  const staleAgentLogin = await request('/auth/login', {
    ...json('POST', { email: agent.email, password: 'api-agent-password-123' }),
  })
  assert.equal(staleAgentLogin.response.status, 401)
  const resetAgentLogin = await request('/auth/login', {
    ...json('POST', { email: agent.email, password: 'api-agent-password-456' }),
  })
  assert.equal(resetAgentLogin.response.status, 200)
  assert.equal(resetAgentLogin.payload.user.role, 'sales_agent')

  const pauseAgent = await request(`/staff/${agent.id}`, {
    ...json('PATCH', { status: 'paused' }),
    cookie: adminCookie,
  })
  assert.equal(pauseAgent.response.status, 200)
  const pausedLogin = await request('/auth/login', {
    ...json('POST', { email: agent.email, password: 'api-agent-password-456' }),
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

  const otherAdminSession = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-admin-password-456' }),
  })
  assert.equal(otherAdminSession.response.status, 200)
  const incorrectCurrentPassword = await request('/auth/change-password', {
    ...json('POST', {
      currentPassword: 'incorrect-current-password',
      newPassword: 'api-admin-password-789',
      confirmPassword: 'api-admin-password-789',
    }),
    cookie: adminCookie,
  })
  assert.equal(incorrectCurrentPassword.response.status, 403)
  const unchangedPassword = await request('/auth/change-password', {
    ...json('POST', {
      currentPassword: 'api-admin-password-456',
      newPassword: 'api-admin-password-456',
      confirmPassword: 'api-admin-password-456',
    }),
    cookie: adminCookie,
  })
  assert.equal(unchangedPassword.response.status, 400)
  const changePassword = await request('/auth/change-password', {
    ...json('POST', {
      currentPassword: 'api-admin-password-456',
      newPassword: 'api-admin-password-789',
      confirmPassword: 'api-admin-password-789',
    }),
    cookie: adminCookie,
  })
  assert.equal(changePassword.response.status, 204)
  assert.equal((await request('/auth/me', { cookie: adminCookie })).response.status, 200)
  assert.equal((await request('/auth/me', { cookie: otherAdminSession.cookie })).response.status, 401)
  assert.equal((await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-admin-password-456' }),
  })).response.status, 401)
  const changedPasswordLogin = await request('/auth/login', {
    ...json('POST', { email: 'api-test-admin@example.invalid', password: 'api-admin-password-789' }),
  })
  assert.equal(changedPasswordLogin.response.status, 200)
  assert.equal((await request('/auth/logout', {
    method: 'POST',
    body: '{}',
    cookie: changedPasswordLogin.cookie,
  })).response.status, 204)

  const logout = await request('/auth/logout', { method: 'POST', body: '{}', cookie: adminCookie })
  assert.equal(logout.response.status, 204)
  assert.equal((await request('/auth/me', { cookie: adminCookie })).response.status, 401)
  assert.equal((await request('/dashboard', { cookie: adminCookie })).response.status, 401)
  adminCookie = null
})
