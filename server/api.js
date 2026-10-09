import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import express from 'express'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import { OAuth2Client } from 'google-auth-library'
import { pool } from './db/pool.js'
import { withDatabaseContext } from './db/transaction.js'
import { hashPassword, verifyPassword } from './auth/password.js'
import {
  convertCurrency,
  currencyRate,
  getExchangeRates,
  isSupportedCurrency,
  supportedCurrencies,
} from './currency.js'

const api = express.Router()
const sessionCookie = 'kajuna_session'
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const dummyPasswordHash = 'scrypt$16384$00000000000000000000000000000000$' + '0'.repeat(128)
const googleClient = new OAuth2Client()

class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

function requireText(value, label, { min = 1, max = 200 } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, `${label} is required.`)
  const result = value.trim()
  if (result.length < min || result.length > max) {
    throw new HttpError(400, `${label} must be between ${min} and ${max} characters.`)
  }
  return result
}

function requireEmail(value) {
  const email = requireText(value, 'Email', { max: 254 }).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, 'Enter a valid email address.')
  return email
}

function requirePassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
    throw new HttpError(400, 'Password must be between 8 and 128 characters.')
  }
  return value
}

function requireInteger(value, label, { min = 0, max = 2_147_483_647 } = {}) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}.`)
  }
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new HttpError(400, `${label} must be a whole number between ${min} and ${max}.`)
  }
  return number
}

function requireAmount(value, label, { min = 0, exclusiveMin = false } = {}) {
  if ((typeof value !== 'number' && typeof value !== 'string') || String(value).trim() === '') {
    throw new HttpError(400, `${label} must be a valid amount.`)
  }
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount > 999_999_999_999 || (exclusiveMin ? amount <= min : amount < min)) {
    throw new HttpError(400, `${label} must be a valid amount.`)
  }
  return Math.round(amount * 100) / 100
}

function requireUuid(value, label = 'ID') {
  if (typeof value !== 'string' || !uuidPattern.test(value)) throw new HttpError(400, `${label} is invalid.`)
  return value
}

function requireObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'A JSON object is required.')
  return value
}

function normalizeUser(row) {
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    status: row.status,
    businessId: row.business_id,
    businessName: row.business_name,
    currency: row.currency || 'TZS',
  }
}

function tokenDigest(token) {
  return createHash('sha256').update(token).digest('hex')
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || ''
  for (const cookie of cookieHeader.split(';')) {
    const separator = cookie.indexOf('=')
    if (separator < 0) continue
    if (cookie.slice(0, separator).trim() === name) {
      try {
        return decodeURIComponent(cookie.slice(separator + 1).trim())
      } catch {
        return null
      }
    }
  }
  return null
}

function setSessionCookie(res, token) {
  const attributes = [
    `${sessionCookie}=${encodeURIComponent(token)}`,
    'Path=/api',
    `Max-Age=${Math.floor(sessionLifetimeMs / 1000)}`,
    'HttpOnly',
    'SameSite=Strict',
  ]
  if (process.env.NODE_ENV === 'production') attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}

function clearSessionCookie(res) {
  const attributes = [`${sessionCookie}=`, 'Path=/api', 'Max-Age=0', 'HttpOnly', 'SameSite=Strict']
  if (process.env.NODE_ENV === 'production') attributes.push('Secure')
  res.setHeader('Set-Cookie', attributes.join('; '))
}

function compareSecret(supplied, expected) {
  if (typeof supplied !== 'string' || !expected) return false
  const suppliedDigest = createHash('sha256').update(supplied).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(suppliedDigest, expectedDigest)
}

async function createSession(client, userId, res) {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + sessionLifetimeMs)
  await client.query(
    'INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)',
    [tokenDigest(token), userId, expiresAt],
  )
  setSessionCookie(res, token)
}

async function verifyGoogleCredential(credential) {
  if (!process.env.GOOGLE_CLIENT_ID) throw new HttpError(503, 'Google sign-in is not configured yet.')
  if (typeof credential !== 'string' || credential.length > 8192) {
    throw new HttpError(400, 'A valid Google credential is required.')
  }
  let ticket
  try {
    ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    })
  } catch {
    throw new HttpError(401, 'Google could not verify this sign-in. Try again.')
  }
  const payload = ticket.getPayload()
  if (!payload?.sub || !payload.email || payload.email_verified !== true) {
    throw new HttpError(401, 'Use a Google account with a verified email address.')
  }
  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    name: payload.name || payload.email.split('@')[0],
  }
}

async function lockGoogleIdentity(client, subject) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtext('kajuna-google:' || $1))",
    [subject],
  )
}

async function assertGoogleIdentityAvailable(client, identity) {
  const { rows: users } = await client.query(
    'SELECT id FROM users WHERE lower(email) = $1 OR google_sub = $2 LIMIT 1',
    [identity.email, identity.sub],
  )
  if (users.length) {
    throw new HttpError(409, 'An account already uses this Google email. Sign in with Google instead of registering another account.')
  }

  const { rows: requests } = await client.query(
    'SELECT id FROM business_registration_requests WHERE lower(email) = $1 OR google_sub = $2 LIMIT 1',
    [identity.email, identity.sub],
  )
  if (requests.length) {
    throw new HttpError(409, 'A business registration for this Google account has already been submitted.')
  }
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next)
}

async function authenticate(req, res, next) {
  const token = readCookie(req, sessionCookie)
  if (!token) return res.status(401).json({ error: 'Sign in to continue.' })

  try {
    const user = await withDatabaseContext(async (client) => {
      const { rows } = await client.query(
        `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.business_id,
          b.name AS business_name, b.currency, b.status AS business_status
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN businesses b ON b.id = u.business_id
        WHERE s.token_hash = $1 AND s.expires_at > now()
        LIMIT 1`,
        [tokenDigest(token)],
      )
      if (rows.length === 0 || rows[0].status !== 'active'
        || (rows[0].business_id && rows[0].business_status !== 'active')) return null
      await client.query('UPDATE auth_sessions SET last_seen_at = now() WHERE token_hash = $1', [tokenDigest(token)])
      return normalizeUser(rows[0])
    }, { platformAdmin: true })

    if (!user) {
      clearSessionCookie(res)
      return res.status(401).json({ error: 'Your session has expired. Sign in again.' })
    }
    req.user = user
    return next()
  } catch (error) {
    return next(error)
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission to perform this action.' })
    return next()
  }
}

function tenantRoute(handler) {
  return asyncRoute(async (req, res) => {
    let statusCode = 200
    let sendResponse
    const deferredResponse = Object.create(res)
    deferredResponse.status = (code) => {
      statusCode = code
      return deferredResponse
    }
    deferredResponse.json = (payload) => {
      sendResponse = () => res.status(statusCode).json(payload)
      return deferredResponse
    }
    deferredResponse.end = (...args) => {
      sendResponse = () => res.status(statusCode).end(...args)
      return deferredResponse
    }

    await withDatabaseContext(
      (client) => handler(req, deferredResponse, client),
      { businessId: req.user.businessId },
    )
    if (!sendResponse) throw new Error('Tenant API route completed without a response.')
    sendResponse()
  })
}

function slugify(value) {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'business'
}

async function loadExchangeRates(context = 'Currency conversion') {
  try {
    return await getExchangeRates()
  } catch (error) {
    throw new HttpError(503, `${context} is unavailable: ${error.message}`)
  }
}

function snapshotExchangeRates(rates, additionalCurrencies = []) {
  const currencies = [...new Set([...supportedCurrencies, ...additionalCurrencies])]
  return Object.fromEntries(
    currencies
      .filter((code) => Number.isFinite(rates[code]) && rates[code] > 0)
      .map((code) => [code, rates[code]]),
  )
}

function convertRecordedAmount(amount, fromCurrency, toCurrency, rates) {
  if (fromCurrency === toCurrency) return Number(amount)
  if (!rates) {
    throw new HttpError(409, `A saved exchange-rate snapshot is required to display this ${fromCurrency} record in ${toCurrency}.`)
  }
  try {
    return convertCurrency(amount, fromCurrency, toCurrency, rates)
  } catch (error) {
    throw new HttpError(503, `The saved exchange-rate snapshot is invalid: ${error.message}`)
  }
}

function mapProduct(row) {
  const currency = row.currency || 'TZS'
  const displayCurrency = row.display_currency || currency
  return {
    id: row.id,
    name: row.name,
    sku: row.sku,
    description: row.description,
    buyingPrice: displayCurrency !== currency
      ? convertRecordedAmount(row.buying_price, currency, displayCurrency, row.exchange_rates)
      : Number(row.buying_price),
    sellingPrice: displayCurrency !== currency
      ? convertRecordedAmount(row.selling_price, currency, displayCurrency, row.exchange_rates)
      : Number(row.selling_price),
    currency: displayCurrency,
    originalCurrency: currency,
    originalBuyingPrice: Number(row.buying_price),
    originalSellingPrice: Number(row.selling_price),
    stock: row.quantity,
    reorderLevel: row.reorder_level,
    status: row.status,
    categoryId: row.category_id,
  }
}

function mapSale(row) {
  const currency = row.currency || 'TZS'
  const displayCurrency = row.display_currency || currency
  const amount = convertRecordedAmount(row.total, currency, displayCurrency, row.exchange_rates)
  const profit = convertRecordedAmount(row.gross_profit || 0, currency, displayCurrency, row.exchange_rates)
  return {
    id: row.receipt_number,
    saleId: row.id,
    customer: row.customer_name,
    item: row.items || '',
    amount,
    originalAmount: Number(row.total),
    originalCurrency: currency,
    convertedAmount: Number(row.converted_total ?? row.total),
    convertedCurrency: row.converted_currency || currency,
    exchangeRate: Number(row.exchange_rate ?? 1),
    rateUpdatedAt: row.fx_rate_updated_at || null,
    ratesStale: row.fx_rate_is_stale || false,
    profit,
    currency: displayCurrency,
    status: row.payment_status === 'paid' ? 'Paid' : row.payment_status,
    soldBy: row.sold_by_name || row.sold_by,
    createdAt: row.created_at,
    businessDateTime: row.business_date_time,
  }
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
})
const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many registration attempts. Try again in 15 minutes.' },
})
const ownerDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many deletion attempts. Try again in 15 minutes.' },
})

api.get('/health', asyncRoute(async (_req, res) => {
  const { rows } = await pool.query('SELECT current_database() AS database, current_setting($1) AS version', ['server_version'])
  res.json({ status: 'ok', database: rows[0].database, postgresVersion: rows[0].version })
}))

api.get('/setup', asyncRoute(async (_req, res) => {
  const setupStatus = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `SELECT
        NOT EXISTS (SELECT 1 FROM users) AS setup_required,
        NOT EXISTS (SELECT 1 FROM users WHERE role = 'platform_admin') AS platform_owner_setup_available`,
    )
    return rows[0]
  }, { platformAdmin: true })
  res.json({
    setupRequired: setupStatus.setup_required,
    platformOwnerSetupAvailable: setupStatus.platform_owner_setup_available,
  })
}))

api.get('/config', (_req, res) => {
  res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null })
})

api.get('/currency-rates', asyncRoute(async (_req, res) => {
  const { rates, updatedAt, nextUpdateAt, provider, isStale } = await loadExchangeRates('Live exchange rates')
  res.json({
    base: 'USD',
    rates: Object.fromEntries(supportedCurrencies.map((code) => [code, rates[code]])),
    supportedCurrencies,
    updatedAt,
    nextUpdateAt,
    provider,
    isStale,
  })
}))

api.post('/currency-convert', authenticate, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const amount = requireAmount(body.amount, 'Amount')
  const fromCurrency = requireText(body.fromCurrency, 'Source currency', { min: 3, max: 3 }).toUpperCase()
  const toCurrency = requireText(body.toCurrency, 'Target currency', { min: 3, max: 3 }).toUpperCase()
  if (!isSupportedCurrency(fromCurrency) || !isSupportedCurrency(toCurrency)) {
    throw new HttpError(400, 'Choose TZS, KES, UGX, USD, EUR, or GBP for both currencies.')
  }

  const exchangeData = await loadExchangeRates('Currency conversion')
  try {
    res.json({
      amount,
      fromCurrency,
      toCurrency,
      rate: currencyRate(fromCurrency, toCurrency, exchangeData.rates),
      convertedAmount: convertCurrency(amount, fromCurrency, toCurrency, exchangeData.rates),
      provider: exchangeData.provider,
      updatedAt: exchangeData.updatedAt,
      nextUpdateAt: exchangeData.nextUpdateAt,
      isStale: exchangeData.isStale,
    })
  } catch (error) {
    throw new HttpError(503, `Currency conversion failed: ${error.message}`)
  }
}))

api.post('/auth/login', loginLimiter, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const email = requireEmail(body.email)
  const password = requirePassword(body.password)

  const result = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.business_id,
        u.password_hash, b.name AS business_name, b.currency, b.status AS business_status
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE lower(u.email) = $1
      ORDER BY u.business_id NULLS FIRST
      LIMIT 20`,
      [email],
    )
    if (rows.length === 0) await verifyPassword(password, dummyPasswordHash)
    const matchingAccounts = []
    for (const candidate of rows) {
      if (await verifyPassword(password, candidate.password_hash)) matchingAccounts.push(candidate)
    }
    if (matchingAccounts.length !== 1) {
      if (rows.length === 0) {
        const { rows: pendingAccounts } = await client.query(
          `SELECT password_hash FROM business_registration_requests
          WHERE lower(email) = $1 AND status = 'pending' LIMIT 1`,
          [email],
        )
        if (pendingAccounts[0] && await verifyPassword(password, pendingAccounts[0].password_hash)) {
          throw new HttpError(403, 'Your business registration is pending owner approval.')
        }
      }
      throw new HttpError(401, 'Email or password is incorrect.')
    }
    const account = matchingAccounts[0]
    if (account.status !== 'active' || (account.business_id && account.business_status !== 'active')) {
      throw new HttpError(403, 'This account is currently unavailable. Contact your business administrator.')
    }
    await createSession(client, account.id, res)
    return normalizeUser(account)
  }, { platformAdmin: true })

  res.json({ user: result })
}))

api.post('/auth/register-platform-owner', registrationLimiter, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const name = requireText(body.name, 'Owner name', { max: 200 })
  const email = requireEmail(body.email)
  const passwordHash = await hashPassword(requirePassword(body.password))
  if (!compareSecret(body.setupToken, process.env.SETUP_TOKEN)) {
    throw new HttpError(403, 'The first-admin setup key is invalid.')
  }

  const user = await withDatabaseContext(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kajuna-platform-owner'))")
    const { rows: existing } = await client.query(
      'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
      [email],
    )
    if (existing.length) throw new HttpError(409, 'An account already uses this email address.')

    const { rows: owners } = await client.query(
      "SELECT id FROM users WHERE role = 'platform_admin' LIMIT 1",
    )
    if (owners.length) throw new HttpError(409, 'The system owner account has already been created.')

    const { rows } = await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, status)
      VALUES ($1, $2, $3, 'platform_admin', 'active')
      RETURNING id, full_name, email, phone, role, status, business_id`,
      [name, email, passwordHash],
    )
    const owner = normalizeUser(rows[0])
    await createSession(client, owner.id, res)
    return owner
  }, { platformAdmin: true })

  res.status(201).json({ user })
}))

api.post('/auth/google/profile', loginLimiter, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const identity = await verifyGoogleCredential(body.credential)
  res.json({ profile: { email: identity.email, name: identity.name } })
}))

api.post('/auth/google', loginLimiter, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const identity = await verifyGoogleCredential(body.credential)
  const user = await withDatabaseContext(async (client) => {
    await lockGoogleIdentity(client, identity.sub)
    const { rows } = await client.query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.business_id,
        u.google_sub, b.name AS business_name, b.currency, b.status AS business_status
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE lower(u.email) = $1 OR u.google_sub = $2
      ORDER BY u.business_id NULLS FIRST
      LIMIT 20`,
      [identity.email, identity.sub],
    )
    const matches = rows.filter((row) => row.email.toLowerCase() === identity.email || row.google_sub === identity.sub)
    if (matches.length !== 1) {
      if (matches.length > 1) throw new HttpError(409, 'This Google account matches more than one user. Sign in with your email and password.')
      const { rows: pending } = await client.query(
        'SELECT id FROM business_registration_requests WHERE lower(email) = $1 OR google_sub = $2 LIMIT 1',
        [identity.email, identity.sub],
      )
      if (pending.length) {
        throw new HttpError(403, 'Your business registration is pending review. Google sign-in will be available after approval.')
      }
      throw new HttpError(401, 'No account uses this Google email yet. Register your business first.')
    }
    const account = matches[0]
    if (account.google_sub && account.google_sub !== identity.sub) {
      throw new HttpError(409, 'This email is already linked to a different Google account.')
    }
    if (account.status !== 'active' || (account.business_id && account.business_status !== 'active')) {
      throw new HttpError(403, 'This account is currently unavailable. Contact your business administrator.')
    }
    if (!account.google_sub) {
      await client.query('UPDATE users SET google_sub = $1 WHERE id = $2', [identity.sub, account.id])
    }
    await createSession(client, account.id, res)
    return normalizeUser(account)
  }, { platformAdmin: true })
  res.json({ user })
}))

api.get('/auth/me', (req, res) => {
  if (!readCookie(req, sessionCookie)) return res.json({ user: null })
  return authenticate(req, res, () => res.json({ user: req.user }))
})

api.post('/auth/logout', authenticate, asyncRoute(async (req, res) => {
  const token = readCookie(req, sessionCookie)
  await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenDigest(token)])
  clearSessionCookie(res)
  res.status(204).end()
}))

api.get('/platform/registration-requests', authenticate, requireRole('platform_admin'), asyncRoute(async (_req, res) => {
  const requests = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `SELECT id, business_name, owner_name, email, phone, industry, created_at
      FROM business_registration_requests
      WHERE status = 'pending'
      ORDER BY created_at ASC, id ASC`,
    )
    return rows.map((row) => ({
      id: row.id,
      businessName: row.business_name,
      ownerName: row.owner_name,
      email: row.email,
      phone: row.phone,
      industry: row.industry,
      createdAt: row.created_at,
    }))
  }, { platformAdmin: true })
  res.json({ requests })
}))

api.patch('/platform/registration-requests/:id', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const id = requireUuid(req.params.id, 'Registration request ID')
  const body = requireObject(req.body)
  if (!['approved', 'rejected'].includes(body.status)) {
    throw new HttpError(400, 'Registration decision must be approved or rejected.')
  }

  const result = await withDatabaseContext(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kajuna-registration:' || $1))", [id])
    const { rows: requests } = await client.query(
      `SELECT id, business_name, owner_name, email, phone, industry, password_hash, google_sub
      FROM business_registration_requests WHERE id = $1 AND status = 'pending' FOR UPDATE`,
      [id],
    )
    const registration = requests[0]
    if (!registration) throw new HttpError(404, 'Pending registration request not found.')

    if (body.status === 'rejected') {
      await client.query(
        `UPDATE business_registration_requests
        SET status = 'rejected', reviewed_by = $1, reviewed_at = now()
        WHERE id = $2`,
        [req.user.id, id],
      )
      await client.query(
        `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
        VALUES (NULL, $1, 'platform_registration_rejected', 'business_registration_request', $2, $3::jsonb)`,
        [req.user.id, id, JSON.stringify({ email: registration.email, businessName: registration.business_name })],
      )
      return { status: 'rejected', requestId: id }
    }

    const { rows: existingUsers } = await client.query(
      'SELECT id FROM users WHERE lower(email) = $1 LIMIT 1',
      [registration.email.toLowerCase()],
    )
    if (existingUsers.length) throw new HttpError(409, 'An account already uses this registration email.')

    const { rows: businesses } = await client.query(
      `INSERT INTO businesses (name, slug, email, phone, industry, status)
      VALUES ($1, $2, $3, $4, $5, 'active')
      RETURNING id, name, currency`,
      [
        registration.business_name,
        `${slugify(registration.business_name)}-${randomBytes(3).toString('hex')}`,
        registration.email,
        registration.phone,
        registration.industry,
      ],
    )
    const business = businesses[0]
    const { rows: users } = await client.query(
      `INSERT INTO users (business_id, full_name, email, phone, password_hash, role, status, google_sub)
      VALUES ($1, $2, $3, $4, $5, 'business_admin', 'active', $6)
      RETURNING id`,
      [
        business.id,
        registration.owner_name,
        registration.email,
        registration.phone,
        registration.password_hash,
        registration.google_sub,
      ],
    )
    const { rows: plans } = await client.query(
      "SELECT id FROM subscription_plans WHERE name = 'Business Growth' AND billing_period = 'monthly' AND active = true LIMIT 1",
    )
    if (plans[0]) {
      await client.query(
        `INSERT INTO subscriptions (business_id, plan_id, status, current_period_end)
        VALUES ($1, $2, 'active', now() + interval '1 month')`,
        [business.id, plans[0].id],
      )
    }
    await client.query(
      `UPDATE business_registration_requests
      SET status = 'approved', reviewed_by = $1, reviewed_at = now()
      WHERE id = $2`,
      [req.user.id, id],
    )
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $1, 'platform_registration_approved', 'business', $2, $3::jsonb)`,
      [req.user.id, business.id, JSON.stringify({ requestId: id, email: registration.email })],
    )
    return {
      status: 'approved',
      requestId: id,
      business: { id: business.id, name: business.name, ownerId: users[0].id, status: 'active' },
    }
  }, { platformAdmin: true })

  res.json(result)
}))

api.get('/platform/subscription-plan', authenticate, requireRole('platform_admin'), asyncRoute(async (_req, res) => {
  const plan = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `SELECT id, name, price, currency, billing_period
      FROM subscription_plans
      WHERE name = 'Business Growth' AND billing_period = 'monthly' AND active = true
      LIMIT 1`,
    )
    if (!rows[0]) throw new HttpError(503, 'The monthly subscription plan is not configured.')
    return {
      id: rows[0].id,
      name: rows[0].name,
      amount: Number(rows[0].price),
      currency: rows[0].currency,
      billingPeriod: rows[0].billing_period,
    }
  }, { platformAdmin: true })
  res.json({ plan })
}))

api.patch('/platform/subscription-plan', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const amount = requireAmount(body.amount, 'Monthly subscription amount', { min: 0, exclusiveMin: true })
  if (amount < 0.01) throw new HttpError(400, 'Monthly subscription amount must be at least 0.01.')
  const plan = await withDatabaseContext(async (client) => {
    const { rows: currentRows } = await client.query(
      `SELECT id, name, price, currency, billing_period
      FROM subscription_plans
      WHERE name = 'Business Growth' AND billing_period = 'monthly' AND active = true
      LIMIT 1 FOR UPDATE`,
    )
    if (!currentRows[0]) throw new HttpError(503, 'The monthly subscription plan is not configured.')
    const { rows } = await client.query(
      `UPDATE subscription_plans SET price = $1 WHERE id = $2
      RETURNING id, name, price, currency, billing_period`,
      [amount, currentRows[0].id],
    )
    const updatedPlan = {
      id: rows[0].id,
      name: rows[0].name,
      amount: Number(rows[0].price),
      currency: rows[0].currency,
      billingPeriod: rows[0].billing_period,
    }
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $1, 'platform_subscription_price_updated', 'subscription_plan', $2, $3::jsonb)`,
      [
        req.user.id,
        updatedPlan.id,
        JSON.stringify({
          previousAmount: Number(currentRows[0].price),
          amount: updatedPlan.amount,
          currency: updatedPlan.currency,
          billingPeriod: updatedPlan.billingPeriod,
        }),
      ],
    )
    return updatedPlan
  }, { platformAdmin: true })

  res.json({ plan })
}))

api.post('/auth/register-business', registrationLimiter, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const name = requireText(body.businessName, 'Business name', { max: 150 })
  const googleIdentity = body.googleCredential ? await verifyGoogleCredential(body.googleCredential) : null
  const ownerName = googleIdentity?.name || requireText(body.ownerName, 'Business owner name')
  const email = googleIdentity?.email || requireEmail(body.email)
  const phone = requireText(body.phone, 'Phone number', { max: 40 })
  const industry = requireText(body.industry, 'Business type', { max: 100 })
  const passwordHash = googleIdentity && !body.password
    ? await hashPassword(randomBytes(48).toString('base64url'))
    : await hashPassword(requirePassword(body.password))

  if (body.setupToken) {
    if (!compareSecret(body.setupToken, process.env.SETUP_TOKEN)) throw new HttpError(403, 'The first-admin setup key is invalid.')
    const user = await withDatabaseContext(async (client) => {
      if (googleIdentity) {
        await lockGoogleIdentity(client, googleIdentity.sub)
        await assertGoogleIdentityAvailable(client, googleIdentity)
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtext('kajuna-first-admin'))")
      const { rows: countRows } = await client.query('SELECT count(*)::integer AS count FROM users')
      if (countRows[0].count !== 0) throw new HttpError(409, 'Initial setup has already been completed.')

      const { rows: businesses } = await client.query(
        `INSERT INTO businesses (name, slug, email, phone, industry, status)
        VALUES ($1, $2, $3, $4, $5, 'active')
        RETURNING id, name, currency`,
        [name, `${slugify(name)}-${randomBytes(3).toString('hex')}`, email, phone, industry],
      )
      const business = businesses[0]
      const { rows: users } = await client.query(
        `INSERT INTO users (business_id, full_name, email, phone, password_hash, role, status, google_sub)
        VALUES ($1, $2, $3, $4, $5, 'business_admin', 'active', $6)
        RETURNING id, full_name, email, phone, role, status, business_id`,
        [business.id, ownerName, email, phone, passwordHash, googleIdentity?.sub || null],
      )
      const userRow = { ...users[0], business_name: business.name, currency: business.currency }
      const { rows: plans } = await client.query(
        "SELECT id FROM subscription_plans WHERE name = 'Business Growth' AND billing_period = 'monthly' AND active = true LIMIT 1",
      )
      if (plans[0]) {
        await client.query(
          `INSERT INTO subscriptions (business_id, plan_id, status, current_period_end)
          VALUES ($1, $2, 'active', now() + interval '1 month')`,
          [business.id, plans[0].id],
        )
      }
      await createSession(client, userRow.id, res)
      return normalizeUser(userRow)
    }, { platformAdmin: true })
    return res.status(201).json({ user })
  }

  await withDatabaseContext(async (client) => {
    if (googleIdentity) {
      await lockGoogleIdentity(client, googleIdentity.sub)
      await assertGoogleIdentityAvailable(client, googleIdentity)
      await client.query("SELECT set_config('app.is_platform_admin', 'false', true)")
    }
    await client.query(
      `INSERT INTO business_registration_requests (business_name, owner_name, email, phone, industry, password_hash, google_sub)
      VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [name, ownerName, email, phone, industry, passwordHash, googleIdentity?.sub || null],
    )
  }, { platformAdmin: Boolean(googleIdentity) })
  res.status(202).json({ message: 'Your business registration request was submitted for review.' })
}))

api.get('/platform/businesses', authenticate, requireRole('platform_admin'), asyncRoute(async (_req, res) => {
  const businesses = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `SELECT b.id, b.name, b.email, b.phone, b.industry, b.status, b.created_at,
        owner.full_name AS owner_name, owner.email AS owner_email,
        coalesce(member_counts.user_count, 0)::integer AS user_count,
        subscription.plan_name, subscription.plan_price, subscription.plan_currency,
        subscription.billing_period, subscription.subscription_status, subscription.current_period_end,
        (subscription.subscription_status IN ('past_due', 'expired', 'cancelled')
          OR subscription.current_period_end <= now()) AS subscription_overdue,
        payment.payment_status AS last_payment_status, payment.paid_at AS last_payment_at
      FROM businesses b
      LEFT JOIN LATERAL (
        SELECT full_name, email FROM users
        WHERE business_id = b.id AND role = 'business_admin'
        ORDER BY created_at, id LIMIT 1
      ) owner ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS user_count FROM users WHERE business_id = b.id
      ) member_counts ON true
      LEFT JOIN LATERAL (
        SELECT p.name AS plan_name, p.price AS plan_price, p.currency AS plan_currency,
          p.billing_period, s.status AS subscription_status, s.current_period_end
        FROM subscriptions s
        JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.business_id = b.id
        ORDER BY s.created_at DESC, s.id DESC LIMIT 1
      ) subscription ON true
      LEFT JOIN LATERAL (
        SELECT status AS payment_status, paid_at
        FROM payments WHERE business_id = b.id
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) payment ON true
      ORDER BY b.created_at DESC, b.name`,
    )
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      phone: row.phone,
      industry: row.industry,
      status: row.status,
      createdAt: row.created_at,
      ownerName: row.owner_name,
      ownerEmail: row.owner_email,
      userCount: row.user_count,
      planName: row.plan_name,
      planPrice: row.plan_price == null ? null : Number(row.plan_price),
      planCurrency: row.plan_currency,
      planBillingPeriod: row.billing_period,
      subscriptionStatus: row.subscription_status,
      currentPeriodEnd: row.current_period_end,
      subscriptionOverdue: row.subscription_overdue,
      lastPaymentStatus: row.last_payment_status,
      lastPaymentAt: row.last_payment_at,
    }))
  }, { platformAdmin: true })
  res.json({ businesses })
}))

api.patch('/platform/businesses/:id', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const id = requireUuid(req.params.id, 'Business ID')
  const body = requireObject(req.body)
  if (!['active', 'suspended'].includes(body.status)) {
    throw new HttpError(400, 'Business status must be active or suspended.')
  }

  const business = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `UPDATE businesses SET status = $1, updated_at = now()
      WHERE id = $2 AND status IN ('active', 'suspended')
      RETURNING id, name, status`,
      [body.status, id],
    )
    if (!rows[0]) throw new HttpError(404, 'Active or suspended business not found.')
    if (body.status === 'suspended') {
      await client.query(
        `DELETE FROM auth_sessions
        WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`,
        [id],
      )
    }
    await client.query(
      `INSERT INTO audit_logs (business_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, 'business', $1, $3::jsonb)`,
      [id, `platform_business_${body.status}`, JSON.stringify({ actorUserId: req.user.id })],
    )
    return rows[0]
  }, { platformAdmin: true })

  res.json({ business: { id: business.id, name: business.name, status: business.status } })
}))

api.delete('/platform/businesses/:id', authenticate, requireRole('platform_admin'), ownerDeleteLimiter, asyncRoute(async (req, res) => {
  const id = requireUuid(req.params.id, 'Business ID')
  const body = requireObject(req.body)
  const password = requirePassword(body.password)

  await withDatabaseContext(async (client) => {
    const { rows: owners } = await client.query(
      "SELECT password_hash FROM users WHERE id = $1 AND role = 'platform_admin' AND status = 'active'",
      [req.user.id],
    )
    if (!owners[0] || !await verifyPassword(password, owners[0].password_hash)) {
      throw new HttpError(403, 'The owner password is incorrect.')
    }

    const { rows: businesses } = await client.query(
      'SELECT id, name, email FROM businesses WHERE id = $1 FOR UPDATE',
      [id],
    )
    if (!businesses[0]) throw new HttpError(404, 'Customer business not found.')

    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $1, 'platform_business_deleted', 'business', $2, $3::jsonb)`,
      [
        req.user.id,
        id,
        JSON.stringify({ businessName: businesses[0].name, businessEmail: businesses[0].email }),
      ],
    )
    await client.query('DELETE FROM businesses WHERE id = $1', [id])
  }, { platformAdmin: true })

  res.status(204).end()
}))

api.get('/dashboard', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const chartRange = req.query.range || 'today'
  const chartDate = req.query.date || new Date().toISOString().slice(0, 10)
  if (!['today', 'day', 'week', 'month', '3months', 'year', 'lastMonth'].includes(chartRange)) {
    throw new HttpError(400, 'Business performance range is invalid.')
  }
  if (typeof chartDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(chartDate)
    || Number.isNaN(Date.parse(`${chartDate}T00:00:00.000Z`))
    || new Date(`${chartDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== chartDate) {
    throw new HttpError(400, 'Business performance date is invalid.')
  }
  const { rows: metricRows } = await client.query(
    `WITH tenant AS (
      SELECT id, timezone, currency, timezone(timezone, now())::date AS local_day
      FROM businesses WHERE id = $1
    ), amounts AS (
      SELECT 'todaySales' AS metric, s.currency, sum(s.total) AS amount,
        s.exchange_rates, bool_or(s.fx_rate_is_stale) AS rates_stale
      FROM sales s CROSS JOIN tenant t
      WHERE s.business_id = t.id AND s.created_at >= (t.local_day::timestamp AT TIME ZONE t.timezone)
        AND s.created_at < ((t.local_day + 1)::timestamp AT TIME ZONE t.timezone) AND s.status = 'completed'
      GROUP BY s.currency, s.exchange_rates
      UNION ALL
      SELECT 'todayExpenses', e.currency, sum(e.amount), e.exchange_rates, bool_or(e.fx_rate_is_stale)
      FROM expenses e CROSS JOIN tenant t
      WHERE e.business_id = t.id AND e.expense_date = t.local_day
      GROUP BY e.currency, e.exchange_rates
      UNION ALL
      SELECT 'revenue', s.currency, sum(s.total), s.exchange_rates, bool_or(s.fx_rate_is_stale)
      FROM sales s CROSS JOIN tenant t
      WHERE s.business_id = t.id
        AND s.created_at >= (date_trunc('month', t.local_day)::date::timestamp AT TIME ZONE t.timezone)
        AND s.created_at < ((t.local_day + 1)::timestamp AT TIME ZONE t.timezone)
        AND s.status = 'completed'
      GROUP BY s.currency, s.exchange_rates
      UNION ALL
      SELECT 'profit', s.currency, sum(si.gross_profit), s.exchange_rates, bool_or(s.fx_rate_is_stale)
      FROM sale_items si JOIN sales s ON s.business_id = si.business_id AND s.id = si.sale_id
      CROSS JOIN tenant t
      WHERE s.business_id = t.id
        AND s.created_at >= (date_trunc('month', t.local_day)::date::timestamp AT TIME ZONE t.timezone)
        AND s.created_at < ((t.local_day + 1)::timestamp AT TIME ZONE t.timezone)
        AND s.status = 'completed'
      GROUP BY s.currency, s.exchange_rates
      UNION ALL
      SELECT 'expenses', e.currency, sum(e.amount), e.exchange_rates, bool_or(e.fx_rate_is_stale)
      FROM expenses e CROSS JOIN tenant t
      WHERE e.business_id = t.id
        AND e.expense_date >= date_trunc('month', t.local_day)::date
        AND e.expense_date <= t.local_day
      GROUP BY e.currency, e.exchange_rates
    )
    SELECT metric, currency, amount, exchange_rates, rates_stale FROM amounts`,
    [req.user.businessId],
  )
  const { rows: businessRows } = await client.query(
    `SELECT currency, timezone(timezone, now())::date AS local_day FROM businesses WHERE id = $1`,
    [req.user.businessId],
  )
  if (!businessRows[0]) throw new HttpError(404, 'Business not found.')
  const displayCurrency = businessRows[0].currency
  const metrics = { todaySales: 0, todayExpenses: 0, revenue: 0, profit: 0, expenses: 0 }
  const fxWarnings = new Set()
  for (const row of metricRows) {
    metrics[row.metric] += convertRecordedAmount(row.amount, row.currency, displayCurrency, row.exchange_rates)
    if (row.rates_stale) fxWarnings.add('One or more transactions were recorded with an outdated exchange-rate snapshot.')
  }
  const { rows: productsSoldRows } = await client.query(
    `WITH tenant AS (
      SELECT id, timezone, timezone(timezone, now())::date AS local_day
      FROM businesses WHERE id = $1
    )
    SELECT coalesce(sum(si.quantity), 0)::integer AS products_sold
    FROM sale_items si JOIN sales s ON s.business_id = si.business_id AND s.id = si.sale_id
    CROSS JOIN tenant t
    WHERE s.business_id = t.id
      AND s.created_at >= (date_trunc('month', t.local_day)::date::timestamp AT TIME ZONE t.timezone)
      AND s.created_at < ((t.local_day + 1)::timestamp AT TIME ZONE t.timezone)
      AND s.status = 'completed'`,
    [req.user.businessId],
  )
  const { rows: inventoryRows } = await client.query(
    `SELECT count(*) FILTER (WHERE status = 'active')::integer AS product_count,
      count(*) FILTER (WHERE status = 'active' AND quantity <= reorder_level)::integer AS low_stock
    FROM products`,
  )
  const { rows: inventoryValueRows } = await client.query(
    `SELECT currency, sum(quantity * buying_price) AS inventory_value
    FROM products WHERE status = 'active' GROUP BY currency`,
  )
  const needsCurrentRates = inventoryValueRows.some((row) => row.currency !== displayCurrency)
  const currentExchangeData = needsCurrentRates ? await loadExchangeRates('Inventory valuation') : null
  metrics.inventoryValue = inventoryValueRows.reduce((sum, row) => {
    if (row.currency === displayCurrency) return sum + Number(row.inventory_value)
    return sum + convertRecordedAmount(row.inventory_value, row.currency, displayCurrency, currentExchangeData.rates)
  }, 0)
  if (currentExchangeData?.isStale) fxWarnings.add('Inventory values use an outdated exchange rate.')
  const { rows: chartRows } = await client.query(
    `WITH tenant AS (
      SELECT id, timezone, currency FROM businesses WHERE id = $1
    ), bounds AS (
      SELECT
        CASE $2
          WHEN 'today' THEN $3::date
          WHEN 'day' THEN $3::date
          WHEN 'week' THEN $3::date - 6
          WHEN 'month' THEN date_trunc('month', $3::date)::date
          WHEN '3months' THEN date_trunc('month', $3::date - interval '2 months')::date
          WHEN 'year' THEN date_trunc('month', $3::date - interval '11 months')::date
          WHEN 'lastMonth' THEN date_trunc('month', $3::date - interval '1 month')::date
        END AS start_day,
        CASE $2
          WHEN 'today' THEN $3::date + 1
          WHEN 'day' THEN $3::date + 1
          WHEN 'week' THEN $3::date + 1
          WHEN 'month' THEN date_trunc('month', $3::date + interval '1 month')::date
          WHEN '3months' THEN date_trunc('month', $3::date + interval '1 month')::date
          WHEN 'year' THEN date_trunc('month', $3::date + interval '1 month')::date
          WHEN 'lastMonth' THEN date_trunc('month', $3::date)::date
        END AS end_day,
        CASE WHEN $2 = 'year' THEN interval '1 month' ELSE interval '1 day' END AS step,
        tenant.id AS business_id, tenant.timezone
      FROM tenant
    ), buckets AS (
      SELECT bucket::date AS bucket, bounds.step, bounds.end_day
      FROM bounds
      CROSS JOIN LATERAL generate_series(
        bounds.start_day::timestamp,
        (bounds.end_day - bounds.step)::timestamp,
        bounds.step
      ) AS bucket
    ), financial_by_bucket AS (
      SELECT date_trunc(CASE WHEN $2 = 'year' THEN 'month' ELSE 'day' END, timezone(bounds.timezone, s.created_at))::date AS bucket,
        'revenue'::text AS metric, s.currency, sum(s.total) AS amount,
        s.exchange_rates, bool_or(s.fx_rate_is_stale) AS rates_stale
      FROM sales s CROSS JOIN bounds
      WHERE s.business_id = bounds.business_id AND s.status = 'completed'
        AND s.created_at >= (bounds.start_day::timestamp AT TIME ZONE bounds.timezone)
        AND s.created_at < (bounds.end_day::timestamp AT TIME ZONE bounds.timezone)
      GROUP BY 1, s.currency, s.exchange_rates
      UNION ALL
      SELECT date_trunc(CASE WHEN $2 = 'year' THEN 'month' ELSE 'day' END, timezone(bounds.timezone, s.created_at))::date,
        'profit', s.currency, sum(si.gross_profit), s.exchange_rates, bool_or(s.fx_rate_is_stale)
      FROM sales s
      JOIN sale_items si ON si.business_id = s.business_id AND si.sale_id = s.id
      CROSS JOIN bounds
      WHERE s.business_id = bounds.business_id AND s.status = 'completed'
        AND s.created_at >= (bounds.start_day::timestamp AT TIME ZONE bounds.timezone)
        AND s.created_at < (bounds.end_day::timestamp AT TIME ZONE bounds.timezone)
      GROUP BY 1, s.currency, s.exchange_rates
      UNION ALL
      SELECT date_trunc(CASE WHEN $2 = 'year' THEN 'month' ELSE 'day' END, e.expense_date)::date,
        'expenses', e.currency, sum(e.amount), e.exchange_rates, bool_or(e.fx_rate_is_stale)
      FROM expenses e CROSS JOIN bounds
      WHERE e.business_id = bounds.business_id
        AND e.expense_date >= bounds.start_day AND e.expense_date < bounds.end_day
      GROUP BY 1, e.currency, e.exchange_rates
    )
    SELECT buckets.bucket,
      CASE WHEN $2 = 'year' THEN to_char(buckets.bucket, 'Mon YYYY') ELSE to_char(buckets.bucket, 'Mon DD') END AS label,
      financial_by_bucket.metric,
      financial_by_bucket.currency,
      financial_by_bucket.amount,
      financial_by_bucket.exchange_rates,
      financial_by_bucket.rates_stale
    FROM buckets
    LEFT JOIN financial_by_bucket ON financial_by_bucket.bucket = buckets.bucket
    ORDER BY buckets.bucket, financial_by_bucket.metric, financial_by_bucket.currency`,
    [req.user.businessId, chartRange, chartDate],
  )
  const chartByDay = new Map()
  for (const row of chartRows) {
    const key = String(row.bucket).slice(0, 10)
    if (!chartByDay.has(key)) {
      chartByDay.set(key, {
        date: key,
        label: row.label,
        revenue: 0,
        expenses: 0,
        netProfit: 0,
      })
    }
    const point = chartByDay.get(key)
    if (!row.metric) continue
    const amount = convertRecordedAmount(row.amount, row.currency, displayCurrency, row.exchange_rates)
    if (row.rates_stale) fxWarnings.add('One or more transactions were recorded with an outdated exchange-rate snapshot.')
    if (row.metric === 'revenue') point.revenue += amount
    if (row.metric === 'expenses') point.expenses += amount
    if (row.metric === 'profit') point.netProfit += amount
  }
  for (const point of chartByDay.values()) point.netProfit -= point.expenses
  const { rows: subscriptionRows } = await client.query(
    `SELECT p.name AS plan_name, p.price, p.currency, p.billing_period, s.status, s.current_period_end
    FROM subscriptions s JOIN subscription_plans p ON p.id = s.plan_id AND p.active
    WHERE s.business_id = $1 AND s.status IN ('trial', 'active', 'past_due')
    ORDER BY s.created_at DESC LIMIT 1`,
    [req.user.businessId],
  )
  let dashboardExchangeData = currentExchangeData
  if (subscriptionRows[0] && subscriptionRows[0].currency !== displayCurrency && !dashboardExchangeData) {
    dashboardExchangeData = await loadExchangeRates('Subscription pricing')
  }
  res.json({
    currency: displayCurrency,
    metrics: {
      ...metrics,
      productsSold: productsSoldRows[0].products_sold,
      lowStock: inventoryRows[0].low_stock,
      productCount: inventoryRows[0].product_count,
    },
    chart: [...chartByDay.values()],
    subscription: subscriptionRows[0] ? {
      name: subscriptionRows[0].plan_name,
      price: subscriptionRows[0].currency !== displayCurrency
        ? convertRecordedAmount(subscriptionRows[0].price, subscriptionRows[0].currency, displayCurrency, dashboardExchangeData.rates)
        : Number(subscriptionRows[0].price),
      billingPeriod: subscriptionRows[0].billing_period,
      status: subscriptionRows[0].status,
      currentPeriodEnd: subscriptionRows[0].current_period_end,
    } : null,
    exchangeRates: dashboardExchangeData ? {
      updatedAt: dashboardExchangeData.updatedAt,
      nextUpdateAt: dashboardExchangeData.nextUpdateAt,
      provider: dashboardExchangeData.provider,
      isStale: dashboardExchangeData.isStale,
    } : null,
    fxWarnings: [...fxWarnings],
  })
}))

api.get('/business', authenticate, tenantRoute(async (req, res, client) => {
  const { rows } = await client.query(
    `SELECT id, name, email, phone, industry, currency, timezone, status FROM businesses WHERE id = $1`,
    [req.user.businessId],
  )
  if (!rows[0]) throw new HttpError(404, 'Business not found.')
  res.json({ business: rows[0] })
}))

api.patch('/business', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const body = requireObject(req.body)
  const allowed = ['name', 'email', 'phone', 'industry', 'currency', 'timezone']
  const fields = allowed.filter((field) => Object.hasOwn(body, field))
  if (!fields.length) throw new HttpError(400, 'Provide at least one supported business field.')
  const values = fields.map((field) => {
    if (field === 'email') return requireEmail(body[field])
    if (field === 'name') return requireText(body[field], 'Business name', { max: 150 })
    if (field === 'currency') {
      const currency = requireText(body[field], 'Currency', { min: 3, max: 3 }).toUpperCase()
      if (!isSupportedCurrency(currency)) {
        throw new HttpError(400, 'Choose TZS, KES, UGX, USD, EUR, or GBP.')
      }
      return currency
    }
    return requireText(body[field], field, { max: field === 'timezone' ? 80 : 100 })
  })
  const currencyIndex = fields.indexOf('currency')
  let currencyChange = false
  let exchangeData = null
  let historicalRatesJson = null
  if (currencyIndex >= 0) {
    const { rows: currentBusiness } = await client.query(
      'SELECT currency FROM businesses WHERE id = $1',
      [req.user.businessId],
    )
    if (!currentBusiness[0]) throw new HttpError(404, 'Business not found.')
    currencyChange = values[currencyIndex] !== currentBusiness[0].currency
    if (currencyChange) {
      exchangeData = await loadExchangeRates('Business currency update')
      const { rows: legacyCounts } = await client.query(
        `SELECT
          (SELECT count(*)::integer FROM sales WHERE exchange_rates IS NULL OR converted_total IS NULL) AS sales,
          (SELECT count(*)::integer FROM expenses WHERE exchange_rates IS NULL OR converted_amount IS NULL) AS expenses`,
      )
      const legacy = legacyCounts[0]
      if (legacy.sales || legacy.expenses) {
        const { rows: legacyCurrencies } = await client.query(
          `SELECT DISTINCT currency::text AS currency
          FROM (
            SELECT currency FROM sales WHERE exchange_rates IS NULL OR converted_total IS NULL
            UNION
            SELECT currency FROM expenses WHERE exchange_rates IS NULL OR converted_amount IS NULL
          ) AS legacy_records`,
        )
        const unsupportedLegacyCurrency = legacyCurrencies.find((row) => !Object.hasOwn(exchangeData.rates, row.currency))
        if (unsupportedLegacyCurrency) {
          throw new HttpError(
            409,
            `The rate provider no longer supports legacy ${unsupportedLegacyCurrency.currency} records. Their values were not changed; contact the system administrator before changing business currency.`,
          )
        }
        historicalRatesJson = JSON.stringify(snapshotExchangeRates(
          exchangeData.rates,
          legacyCurrencies.map((row) => row.currency),
        ))
      }
      if ((legacy.sales || legacy.expenses) && body.confirmHistoricalConversion !== true) {
        throw new HttpError(
          409,
          `${legacy.sales} sales and ${legacy.expenses} expenses lack saved exchange-rate snapshots. Confirm once to preserve their original values and save a one-time conversion snapshot.`,
        )
      }
      if (legacy.sales || legacy.expenses) {
        const ratesJson = historicalRatesJson
        await client.query(
          `UPDATE sales SET
            exchange_rate = 1 / (($1::jsonb ->> currency::text)::numeric),
            converted_total = round(total / (($1::jsonb ->> currency::text)::numeric) * (($1::jsonb ->> $2)::numeric), 2),
            converted_currency = $2,
            exchange_rates = $1::jsonb,
            fx_rate_updated_at = $3,
            fx_rate_is_stale = $4
          WHERE exchange_rates IS NULL OR converted_total IS NULL`,
          [ratesJson, values[currencyIndex], exchangeData.updatedAt, exchangeData.isStale],
        )
        await client.query(
          `UPDATE expenses SET
            exchange_rate = 1 / (($1::jsonb ->> currency::text)::numeric),
            converted_amount = round(amount / (($1::jsonb ->> currency::text)::numeric) * (($1::jsonb ->> $2)::numeric), 2),
            converted_currency = $2,
            exchange_rates = $1::jsonb,
            fx_rate_updated_at = $3,
            fx_rate_is_stale = $4
          WHERE exchange_rates IS NULL OR converted_amount IS NULL`,
          [ratesJson, values[currencyIndex], exchangeData.updatedAt, exchangeData.isStale],
        )
      }
    }
  }
  const assignments = fields.map((field, index) => `${field} = $${index + 1}`).join(', ')
  const { rows } = await client.query(
    `UPDATE businesses SET ${assignments}, updated_at = now() WHERE id = $${fields.length + 1}
    RETURNING id, name, email, phone, industry, currency, timezone, status`,
    [...values, req.user.businessId],
  )
  res.json({
    business: rows[0],
    ...(currencyChange ? {
      exchangeRates: {
        updatedAt: exchangeData.updatedAt,
        isStale: exchangeData.isStale,
      },
    } : {}),
  })
}))

api.get('/products', authenticate, tenantRoute(async (_req, res, client) => {
  const { rows: businesses } = await client.query('SELECT currency FROM businesses WHERE id = $1', [_req.user.businessId])
  if (!businesses[0]) throw new HttpError(404, 'Business not found.')
  const displayCurrency = businesses[0].currency
  const { rows } = await client.query(
    `SELECT id, name, sku, description, buying_price, selling_price, quantity, reorder_level, status, category_id, currency
    FROM products WHERE business_id = $1 AND status = 'active' ORDER BY name`,
    [_req.user.businessId],
  )
  if (rows.some((row) => row.currency !== displayCurrency)) {
    const exchangeData = await loadExchangeRates('Inventory valuation')
    rows.forEach((row) => { row.display_currency = displayCurrency; row.exchange_rates = exchangeData.rates })
  }
  res.json({ products: rows.map(mapProduct) })
}))

api.post('/products', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const body = requireObject(req.body)
  const name = requireText(body.name, 'Product name')
  const sku = body.sku === undefined || body.sku === null || String(body.sku).trim() === ''
    ? `AUTO-${randomBytes(6).toString('hex').toUpperCase()}`
    : requireText(body.sku, 'SKU', { max: 100 })
  const buyingPrice = requireAmount(body.buyingPrice, 'Buying price')
  const sellingPrice = requireAmount(body.sellingPrice, 'Selling price')
  const quantity = requireInteger(body.quantity, 'Stock quantity')
  const reorderLevel = body.reorderLevel === undefined || body.reorderLevel === null || String(body.reorderLevel).trim() === ''
    ? 10
    : requireInteger(body.reorderLevel, 'Reorder level')
  if (sellingPrice <= buyingPrice) throw new HttpError(400, 'Selling price must be greater than buying price.')
  const categoryId = body.categoryId ? requireUuid(body.categoryId, 'Category ID') : null
  const { rows: businesses } = await client.query(
    'SELECT currency FROM businesses WHERE id = $1',
    [req.user.businessId],
  )
  if (!businesses[0]) throw new HttpError(404, 'Business not found.')
  const { rows } = await client.query(
    `INSERT INTO products (business_id, category_id, name, sku, buying_price, selling_price, quantity, reorder_level, currency)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id, name, sku, description, buying_price, selling_price, quantity, reorder_level, status, category_id, currency`,
    [req.user.businessId, categoryId, name, sku, buyingPrice, sellingPrice, quantity, reorderLevel, businesses[0].currency],
  )
  if (quantity > 0) {
    await client.query(
      `INSERT INTO stock_movements (business_id, product_id, performed_by, movement_type, quantity_change, unit_cost, currency)
      VALUES ($1, $2, $3, 'opening', $4, $5, $6)`,
      [req.user.businessId, rows[0].id, req.user.id, quantity, buyingPrice, businesses[0].currency],
    )
  }
  res.status(201).json({ product: mapProduct(rows[0]) })
}))

api.patch('/products/:id', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const id = requireUuid(req.params.id, 'Product ID')
  const body = requireObject(req.body)
  const fields = ['name', 'sku', 'description', 'buyingPrice', 'sellingPrice', 'reorderLevel', 'status']
    .filter((field) => Object.hasOwn(body, field))
  if (!fields.length) throw new HttpError(400, 'Provide at least one supported product field.')
  const columnNames = {
    name: 'name', sku: 'sku', description: 'description', buyingPrice: 'buying_price',
    sellingPrice: 'selling_price', reorderLevel: 'reorder_level', status: 'status',
  }
  const current = await client.query('SELECT buying_price, selling_price FROM products WHERE id = $1 FOR UPDATE', [id])
  if (!current.rows[0]) throw new HttpError(404, 'Product not found.')
  let buying = Number(current.rows[0].buying_price)
  let selling = Number(current.rows[0].selling_price)
  const values = fields.map((field) => {
    if (field === 'name') return requireText(body[field], 'Product name')
    if (field === 'sku') return requireText(body[field], 'SKU', { max: 100 })
    if (field === 'description') return body[field] === null ? null : requireText(body[field], 'Description', { max: 2000 })
    if (field === 'buyingPrice') buying = requireAmount(body[field], 'Buying price')
    if (field === 'sellingPrice') selling = requireAmount(body[field], 'Selling price')
    if (field === 'reorderLevel') return requireInteger(body[field], 'Reorder level')
    if (field === 'status') {
      if (!['active', 'archived'].includes(body[field])) throw new HttpError(400, 'Product status is invalid.')
      return body[field]
    }
    return field === 'buyingPrice' ? buying : selling
  })
  if (selling <= buying) throw new HttpError(400, 'Selling price must be greater than buying price.')
  const updates = fields.map((field, index) => `${columnNames[field]} = $${index + 1}`)
  const updateValues = [...values]
  if (fields.includes('buyingPrice') || fields.includes('sellingPrice')) {
    updateValues.push(req.user.businessId)
    const currencyParameter = updateValues.length
    updates.push(`currency = (SELECT currency FROM businesses WHERE id = $${currencyParameter})`)
  }
  const idParameter = updateValues.length + 1
  const { rows } = await client.query(
    `UPDATE products SET ${updates.join(', ')}, updated_at = now() WHERE id = $${idParameter}
    RETURNING id, name, sku, description, buying_price, selling_price, quantity, reorder_level, status, category_id, currency`,
    [...updateValues, id],
  )
  res.json({ product: mapProduct(rows[0]) })
}))

api.post('/products/:id/restock', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const id = requireUuid(req.params.id, 'Product ID')
  const body = requireObject(req.body)
  const quantity = requireInteger(body.quantity, 'Restock quantity', { min: 1 })
  const { rows } = await client.query(
    `UPDATE products SET quantity = quantity + $1, updated_at = now()
    WHERE id = $2 AND status = 'active'
    RETURNING id, name, sku, description, buying_price, selling_price, quantity, reorder_level, status, category_id, currency`,
    [quantity, id],
  )
  if (!rows[0]) throw new HttpError(404, 'Active product not found.')
  await client.query(
    `INSERT INTO stock_movements (business_id, product_id, performed_by, movement_type, quantity_change, unit_cost, currency)
    VALUES ($1, $2, $3, 'restock', $4, $5, $6)`,
    [req.user.businessId, id, req.user.id, quantity, rows[0].buying_price, rows[0].currency],
  )
  res.json({ product: mapProduct(rows[0]) })
}))

api.get('/categories', authenticate, tenantRoute(async (_req, res, client) => {
  const { rows } = await client.query('SELECT id, name, description FROM categories ORDER BY name')
  res.json({ categories: rows })
}))

api.post('/categories', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const body = requireObject(req.body)
  const name = requireText(body.name, 'Category name', { max: 120 })
  const description = body.description ? requireText(body.description, 'Description', { max: 1000 }) : null
  const { rows } = await client.query(
    `INSERT INTO categories (business_id, name, description) VALUES ($1, $2, $3) RETURNING id, name, description`,
    [req.user.businessId, name, description],
  )
  res.status(201).json({ category: rows[0] })
}))

api.patch('/categories/:id', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const id = requireUuid(req.params.id, 'Category ID')
  const body = requireObject(req.body)
  const hasName = Object.hasOwn(body, 'name')
  const hasDescription = Object.hasOwn(body, 'description')
  if (!hasName && !hasDescription) throw new HttpError(400, 'Provide a category name or description.')
  const name = hasName ? requireText(body.name, 'Category name', { max: 120 }) : null
  const description = hasDescription ? (body.description ? requireText(body.description, 'Description', { max: 1000 }) : null) : null
  const { rows } = await client.query(
    `UPDATE categories SET name = coalesce($1, name), description = CASE WHEN $2 THEN $3 ELSE description END
    WHERE id = $4 RETURNING id, name, description`,
    [name, hasDescription, description, id],
  )
  if (!rows[0]) throw new HttpError(404, 'Category not found.')
  res.json({ category: rows[0] })
}))

api.delete('/categories/:id', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const id = requireUuid(req.params.id, 'Category ID')
  const result = await client.query('DELETE FROM categories WHERE id = $1', [id])
  if (!result.rowCount) throw new HttpError(404, 'Category not found.')
  res.status(204).end()
}))

api.get('/sales', authenticate, tenantRoute(async (req, res, client) => {
  const conditions = ['s.business_id = $1']
  const values = [req.user.businessId]
  if (req.user.role === 'sales_agent') {
    values.push(req.user.id)
    conditions.push(`s.sold_by = $${values.length}`)
  }
  if (req.query.date !== undefined) {
    const date = req.query.date
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
      || Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))
      || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
      throw new HttpError(400, 'Sale date must use YYYY-MM-DD format.')
    }
    values.push(date)
    const dateParameter = `$${values.length}`
    conditions.push(`s.created_at >= (${dateParameter}::date::timestamp AT TIME ZONE b.timezone)
      AND s.created_at < ((${dateParameter}::date + 1)::timestamp AT TIME ZONE b.timezone)`)
  }
  const { rows } = await client.query(
    `SELECT s.id, s.receipt_number, s.customer_name, s.total, s.payment_status, s.sold_by, s.currency,
      s.exchange_rate, s.converted_total, s.converted_currency, s.exchange_rates,
      s.fx_rate_updated_at, s.fx_rate_is_stale,
      u.full_name AS sold_by_name, s.created_at,
      to_char(timezone(b.timezone, s.created_at), 'YYYY-MM-DD HH24:MI:SS') AS business_date_time,
      coalesce(string_agg(si.product_name || ' ×' || si.quantity, ', ' ORDER BY si.created_at), '') AS items,
      coalesce(sum(si.gross_profit), 0) AS gross_profit,
      b.currency AS display_currency
    FROM sales s
    JOIN businesses b ON b.id = s.business_id
    LEFT JOIN users u ON u.business_id = s.business_id AND u.id = s.sold_by
    LEFT JOIN sale_items si ON si.business_id = s.business_id AND si.sale_id = s.id
    WHERE ${conditions.join(' AND ')}
    GROUP BY s.id, u.full_name, b.timezone, b.currency ORDER BY s.created_at DESC LIMIT 500`,
    values,
  )
  res.json({ sales: rows.map(mapSale) })
}))

api.post('/sales', authenticate, tenantRoute(async (req, res, client) => {
  const body = requireObject(req.body)
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    throw new HttpError(400, 'A sale must contain between 1 and 100 product lines.')
  }
  const customer = body.customer === undefined || body.customer === '' ? 'Walk-in customer' : requireText(body.customer, 'Customer name', { max: 150 })
  const quantities = new Map()
  for (const line of body.items) {
    requireObject(line)
    const productId = requireUuid(line.productId, 'Product ID')
    const quantity = requireInteger(line.quantity, 'Sale quantity', { min: 1 })
    quantities.set(productId, (quantities.get(productId) || 0) + quantity)
  }
  const productIds = [...quantities.keys()]
  const { rows: products } = await client.query(
    `SELECT id, name, buying_price, selling_price, quantity, currency FROM products
    WHERE id = ANY($1::uuid[]) AND status = 'active' ORDER BY id FOR UPDATE`,
    [productIds],
  )
  const { rows: businesses } = await client.query(
    'SELECT currency FROM businesses WHERE id = $1',
    [req.user.businessId],
  )
  if (!businesses[0]) throw new HttpError(404, 'Business not found.')
  const saleCurrency = businesses[0].currency
  if (products.length !== productIds.length) throw new HttpError(400, 'One or more selected products are unavailable.')
  const exchangeData = await loadExchangeRates('Recording sale')
  for (const product of products) {
    const sourceCurrency = product.currency || 'TZS'
    product.sale_buying_price = convertRecordedAmount(product.buying_price, sourceCurrency, saleCurrency, exchangeData.rates)
    product.sale_selling_price = convertRecordedAmount(product.selling_price, sourceCurrency, saleCurrency, exchangeData.rates)
  }
  for (const product of products) {
    if (product.quantity < quantities.get(product.id)) throw new HttpError(409, `Not enough stock for ${product.name}.`)
  }
  const total = requireAmount(
    products.reduce((sum, product) => sum + product.sale_selling_price * quantities.get(product.id), 0),
    'Sale total',
  )
  const receipt = `BMS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex').toUpperCase()}`
  const savedRates = snapshotExchangeRates(exchangeData.rates)
  const { rows: sales } = await client.query(
    `INSERT INTO sales (
      business_id, receipt_number, customer_name, sold_by, status, payment_status, payment_method,
      subtotal, total, completed_at, currency, exchange_rate, converted_total, converted_currency,
      exchange_rates, fx_rate_updated_at, fx_rate_is_stale
    )
    VALUES ($1, $2, $3, $4, 'completed', 'paid', $5, $6, $6, now(), $7, $8, $6, $7, $9::jsonb, $10, $11)
    RETURNING id, receipt_number, customer_name, total, payment_status, sold_by, created_at,
      exchange_rate, converted_total, converted_currency, exchange_rates, fx_rate_updated_at, fx_rate_is_stale`,
    [
      req.user.businessId, receipt, customer, req.user.id,
      ['cash', 'mobile_money', 'card', 'bank_transfer', 'other'].includes(body.paymentMethod) ? body.paymentMethod : 'cash',
      total, saleCurrency, currencyRate(saleCurrency, 'USD', exchangeData.rates),
      JSON.stringify(savedRates), exchangeData.updatedAt, exchangeData.isStale,
    ],
  )
  const sale = sales[0]
  for (const product of products) {
    const quantity = quantities.get(product.id)
    await client.query(
      `INSERT INTO sale_items (business_id, sale_id, product_id, product_name, quantity, unit_buying_price, unit_selling_price, currency)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [req.user.businessId, sale.id, product.id, product.name, quantity, product.sale_buying_price, product.sale_selling_price, saleCurrency],
    )
    await client.query(
      `UPDATE products SET quantity = quantity - $1, updated_at = now() WHERE id = $2`,
      [quantity, product.id],
    )
    await client.query(
      `INSERT INTO stock_movements (business_id, product_id, performed_by, movement_type, quantity_change, unit_cost, note, currency)
      VALUES ($1, $2, $3, 'sale', $4, $5, $6, $7)`,
      [req.user.businessId, product.id, req.user.id, -quantity, product.sale_buying_price, sale.receipt_number, saleCurrency],
    )
  }
  res.status(201).json({ sale: mapSale({
    ...sale,
    currency: saleCurrency,
    display_currency: saleCurrency,
    exchange_rates: savedRates,
    items: products.map((product) => `${product.name} ×${quantities.get(product.id)}`).join(', '),
    gross_profit: products.reduce((sum, product) => sum + (product.sale_selling_price - product.sale_buying_price) * quantities.get(product.id), 0),
  }), ratesStale: exchangeData.isStale })
}))

api.get('/expenses', authenticate, requireRole('business_admin'), tenantRoute(async (_req, res, client) => {
  const { rows: businesses } = await client.query('SELECT currency FROM businesses WHERE id = $1', [_req.user.businessId])
  if (!businesses[0]) throw new HttpError(404, 'Business not found.')
  const displayCurrency = businesses[0].currency
  const { rows } = await client.query(
    `SELECT id, category, description, amount, currency, converted_amount, converted_currency,
      exchange_rate, exchange_rates, fx_rate_updated_at, fx_rate_is_stale,
      expense_date::text AS expense_date, created_at
    FROM expenses ORDER BY expense_date DESC, created_at DESC LIMIT 500`,
  )
  res.json({
    expenses: rows.map((row) => ({
      ...row,
      amount: convertRecordedAmount(row.amount, row.currency, displayCurrency, row.exchange_rates),
      originalAmount: Number(row.amount),
      originalCurrency: row.currency,
      convertedAmount: Number(row.converted_amount ?? row.amount),
      convertedCurrency: row.converted_currency || row.currency,
      exchangeRate: Number(row.exchange_rate ?? 1),
      rateUpdatedAt: row.fx_rate_updated_at || null,
      ratesStale: row.fx_rate_is_stale || false,
    })),
  })
}))

api.post('/expenses', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const body = requireObject(req.body)
  const category = requireText(body.category, 'Expense category', { max: 100 })
  const description = requireText(body.description, 'Expense description', { max: 1000 })
  const amount = requireAmount(body.amount, 'Expense amount', { min: 0, exclusiveMin: true })
  let expenseDate = body.expenseDate
  if (!expenseDate) {
    const { rows: businessRows } = await client.query(
      'SELECT timezone(timezone, now())::date::text AS business_today FROM businesses WHERE id = $1',
      [req.user.businessId],
    )
    if (!businessRows[0]) throw new HttpError(404, 'Business not found.')
    expenseDate = businessRows[0].business_today
  }
  if (typeof expenseDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(expenseDate)
    || Number.isNaN(Date.parse(`${expenseDate}T00:00:00Z`))
    || new Date(`${expenseDate}T00:00:00Z`).toISOString().slice(0, 10) !== expenseDate) {
    throw new HttpError(400, 'Expense date must use YYYY-MM-DD format.')
  }
  const { rows: businesses } = await client.query('SELECT currency FROM businesses WHERE id = $1', [req.user.businessId])
  if (!businesses[0]) throw new HttpError(404, 'Business not found.')
  const expenseCurrency = businesses[0].currency
  const exchangeData = await loadExchangeRates('Recording expense')
  const savedRates = snapshotExchangeRates(exchangeData.rates)
  const { rows } = await client.query(
    `INSERT INTO expenses (
      business_id, recorded_by, category, description, amount, expense_date, currency,
      exchange_rate, converted_amount, converted_currency, exchange_rates, fx_rate_updated_at, fx_rate_is_stale
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $5, $7, $9::jsonb, $10, $11)
    RETURNING id, category, description, amount, currency, converted_amount, converted_currency,
      exchange_rate, exchange_rates, fx_rate_updated_at, fx_rate_is_stale, expense_date::text AS expense_date, created_at`,
    [
      req.user.businessId, req.user.id, category, description, amount, expenseDate, expenseCurrency,
      currencyRate(expenseCurrency, 'USD', exchangeData.rates), JSON.stringify(savedRates),
      exchangeData.updatedAt, exchangeData.isStale,
    ],
  )
  res.status(201).json({
    expense: {
      ...rows[0],
      amount: Number(rows[0].amount),
      convertedAmount: Number(rows[0].converted_amount),
      convertedCurrency: rows[0].converted_currency,
      exchangeRate: Number(rows[0].exchange_rate),
      ratesStale: rows[0].fx_rate_is_stale,
    },
  })
}))

api.get('/staff', authenticate, requireRole('business_admin'), tenantRoute(async (_req, res, client) => {
  const { rows } = await client.query(
    `SELECT u.id, u.full_name, u.email, u.phone, u.status, count(s.id)::integer AS sales_count
    FROM users u LEFT JOIN sales s ON s.business_id = u.business_id AND s.sold_by = u.id
    WHERE u.role = 'sales_agent' AND u.status <> 'disabled'
    GROUP BY u.id ORDER BY u.created_at DESC`,
  )
  res.json({
    agents: rows.map((row) => ({
      id: row.id,
      name: row.full_name,
      email: row.email,
      phone: row.phone,
      status: row.status,
      sales: row.sales_count,
    })),
  })
}))

api.post('/staff', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const body = requireObject(req.body)
  const name = requireText(body.name, 'Full name')
  const email = requireEmail(body.email)
  const phone = requireText(body.phone, 'Phone number', { max: 40 })
  const password = requirePassword(body.password)
  const passwordHash = await hashPassword(password)
  const { rows } = await client.query(
    `INSERT INTO users (business_id, full_name, email, phone, password_hash, role, status)
    VALUES ($1, $2, $3, $4, $5, 'sales_agent', 'active')
    RETURNING id, full_name, email, phone, status`,
    [req.user.businessId, name, email, phone, passwordHash],
  )
  res.status(201).json({ agent: { id: rows[0].id, name: rows[0].full_name, email: rows[0].email, phone: rows[0].phone, status: rows[0].status, sales: 0 } })
}))

api.patch('/staff/:id', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const id = requireUuid(req.params.id, 'Agent ID')
  const body = requireObject(req.body)
  if (!['active', 'paused'].includes(body.status)) throw new HttpError(400, 'Agent status must be active or paused.')
  const { rows } = await client.query(
    `UPDATE users SET status = $1, updated_at = now()
    WHERE id = $2 AND role = 'sales_agent'
    RETURNING id, full_name, email, phone, status`,
    [body.status, id],
  )
  if (!rows[0]) throw new HttpError(404, 'Sales agent not found.')
  if (body.status === 'paused') await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [id])
  res.json({ agent: { id: rows[0].id, name: rows[0].full_name, email: rows[0].email, phone: rows[0].phone, status: rows[0].status } })
}))

api.delete('/staff/:id', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const id = requireUuid(req.params.id, 'Agent ID')
  const result = await client.query(
    `UPDATE users SET status = 'disabled', updated_at = now() WHERE id = $1 AND role = 'sales_agent'`,
    [id],
  )
  if (!result.rowCount) throw new HttpError(404, 'Sales agent not found.')
  await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [id])
  res.status(204).end()
}))

export function createApiApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(express.json({ limit: '32kb', strict: true }))
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const allowedOrigin = process.env.APP_ORIGIN || 'http://localhost:5173'
      if (req.get('origin') !== allowedOrigin) return res.status(403).json({ error: 'Request origin is not allowed.' })
      const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'))
      if (hasBody && !req.is('application/json')) return res.status(415).json({ error: 'Requests must use application/json.' })
    }
    return next()
  })
  app.use('/api', api)
  app.use((req, res) => res.status(404).json({ error: 'API route not found.' }))
  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message })
    if (error?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body must be valid JSON.' })
    if (error?.code === '23505') return res.status(409).json({ error: 'A record with those details already exists.' })
    if (error?.code === '23503' || error?.code === '23514' || error?.code === '22P02') {
      return res.status(400).json({ error: 'The request conflicts with existing data or a validation rule.' })
    }
    console.error('API request failed:', error)
    return res.status(500).json({ error: 'An unexpected server error occurred.' })
  })
  return app
}
