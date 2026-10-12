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
const paymentMethods = ['mobile_money', 'card', 'bank_transfer', 'cash', 'other']
const maxBusinessLogoBytes = 5 * 1024 * 1024

function detectBusinessLogoMimeType(image) {
  if (image.length >= 8
    && image.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png'
  }
  if (image.length >= 3 && image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff) {
    return 'image/jpeg'
  }
  if (image.length >= 12
    && image.toString('ascii', 0, 4) === 'RIFF'
    && image.toString('ascii', 8, 12) === 'WEBP') {
    return 'image/webp'
  }
  return null
}

function addBillingPeriod(date, billingPeriod) {
  const next = new Date(date)
  if (billingPeriod === 'quarterly') next.setUTCMonth(next.getUTCMonth() + 3)
  else if (billingPeriod === 'yearly') next.setUTCFullYear(next.getUTCFullYear() + 1)
  else next.setUTCMonth(next.getUTCMonth() + 1)
  return next
}

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

function requireConfirmedPassword(body) {
  const password = requirePassword(body.password)
  if (typeof body.confirmPassword !== 'string' || body.confirmPassword !== password) {
    throw new HttpError(400, 'Password confirmation does not match.')
  }
  return password
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
    theme: row.theme || 'dark',
    language: row.language || 'en',
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
        `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.business_id, u.theme, u.language,
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
  limit: Number(process.env.AUTH_RATE_LIMIT_MAX || 10),
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Try again in 15 minutes.' },
})
const ownerDeleteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many deletion attempts. Try again in 15 minutes.' },
})
const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many password reset attempts. Try again in 15 minutes.' },
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
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.business_id, u.theme, u.language,
        u.password_hash, b.name AS business_name, b.currency, b.status AS business_status
      FROM users u
      LEFT JOIN businesses b ON b.id = u.business_id
      WHERE lower(u.email) = $1
      ORDER BY u.business_id NULLS FIRST
      LIMIT 20`,
      [email],
    )
    if (rows.length === 0) {
      const { rows: requests } = await client.query(
        'SELECT status FROM business_registration_requests WHERE lower(email) = $1 LIMIT 1',
        [email],
      )
      if (requests[0]?.status === 'pending') {
        throw new HttpError(403, 'Your business application is still pending review. You will be able to sign in once the system administrator approves it.')
      }
      if (requests[0]?.status === 'rejected') {
        throw new HttpError(403, 'Your business application was rejected. Contact the system administrator for assistance.')
      }
      await verifyPassword(password, dummyPasswordHash)
    }
    const matchingAccounts = []
    for (const candidate of rows) {
      if (await verifyPassword(password, candidate.password_hash)) matchingAccounts.push(candidate)
    }
    if (matchingAccounts.length !== 1) throw new HttpError(401, 'Email or password is incorrect.')
    const account = matchingAccounts[0]
    if (account.status !== 'active' || (account.business_id && account.business_status !== 'active')) {
      throw new HttpError(403, 'This account is currently unavailable. Contact your business administrator.')
    }
    await createSession(client, account.id, res)
    return normalizeUser(account)
  }, { platformAdmin: true })

  res.json({ user: result })
}))

api.post('/auth/register-platform-owner', loginLimiter, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const name = requireText(body.name, 'Owner name', { max: 200 })
  const email = requireEmail(body.email)
  const passwordHash = await hashPassword(requireConfirmedPassword(body))
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
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.business_id, u.theme, u.language,
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
        'SELECT status FROM business_registration_requests WHERE lower(email) = $1 OR google_sub = $2 LIMIT 1',
        [identity.email, identity.sub],
      )
      if (pending.length) {
        if (pending[0].status === 'rejected') {
          throw new HttpError(403, 'Your business application was rejected. Contact the system administrator for assistance.')
        }
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

api.patch('/auth/preferences', authenticate, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const entries = Object.entries(body)
  if (!entries.length || entries.some(([key]) => !['theme', 'language'].includes(key))) {
    throw new HttpError(400, 'Provide a theme or language preference.')
  }
  if (body.theme !== undefined && !['light', 'dark'].includes(body.theme)) {
    throw new HttpError(400, 'Theme must be light or dark.')
  }
  if (body.language !== undefined && !['en', 'sw'].includes(body.language)) {
    throw new HttpError(400, 'Language must be English or Swahili.')
  }

  const preferences = await withDatabaseContext(async (client) => {
    const assignments = []
    const values = [req.user.id]
    for (const key of ['theme', 'language']) {
      if (body[key] === undefined) continue
      values.push(body[key])
      assignments.push(`${key} = $${values.length}`)
    }
    const { rows: updated } = await client.query(
      `UPDATE users SET ${assignments.join(', ')}, updated_at = now()
      WHERE id = $1 RETURNING theme, language`,
      values,
    )
    if (!updated[0]) throw new HttpError(401, 'Sign in to continue.')
    return updated[0]
  }, { platformAdmin: true })

  res.json({ preferences: { theme: preferences.theme, language: preferences.language } })
}))

api.post('/auth/change-password', authenticate, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const currentPassword = requirePassword(body.currentPassword)
  const newPassword = requireConfirmedPassword({
    password: body.newPassword,
    confirmPassword: body.confirmPassword,
  })
  if (currentPassword === newPassword) {
    throw new HttpError(400, 'Choose a new password different from your current password.')
  }

  const passwordHash = await hashPassword(newPassword)
  const token = readCookie(req, sessionCookie)
  await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      'SELECT password_hash FROM users WHERE id = $1 AND status = $2 FOR UPDATE',
      [req.user.id, 'active'],
    )
    if (!rows[0] || !await verifyPassword(currentPassword, rows[0].password_hash)) {
      throw new HttpError(403, 'Current password is incorrect.')
    }

    await client.query(
      'UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2',
      [passwordHash, req.user.id],
    )
    await client.query(
      'DELETE FROM auth_sessions WHERE user_id = $1 AND token_hash <> $2',
      [req.user.id, tokenDigest(token)],
    )
  }, { platformAdmin: true })

  res.status(204).end()
}))

api.post('/auth/logout', authenticate, asyncRoute(async (req, res) => {
  const token = readCookie(req, sessionCookie)
  await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [tokenDigest(token)])
  clearSessionCookie(res)
  res.status(204).end()
}))

async function provisionApprovedApplication(client, application, actorUserId) {
  if (application.google_sub) {
    await lockGoogleIdentity(client, application.google_sub)
  }
  const { rows: businesses } = await client.query(
    `INSERT INTO businesses (name, slug, email, phone, industry, status)
    VALUES ($1, $2, $3, $4, $5, 'active')
    RETURNING id, name, currency, status`,
    [
      application.business_name,
      `${slugify(application.business_name)}-${randomBytes(3).toString('hex')}`,
      application.email,
      application.phone,
      application.industry,
    ],
  )
  const business = businesses[0]
  const { rows: users } = await client.query(
    `INSERT INTO users (business_id, full_name, email, phone, password_hash, role, status, google_sub)
    VALUES ($1, $2, $3, $4, $5, 'business_admin', 'active', $6)
    RETURNING id, full_name, email, phone, role, status, business_id`,
    [business.id, application.owner_name, application.email, application.phone, application.password_hash, application.google_sub || null],
  )
  const user = users[0]
  const { rows: plans } = await client.query(
    `SELECT id, price, currency FROM subscription_plans
    WHERE name = 'Business Growth' AND active = true LIMIT 1`,
  )
  if (plans[0]) {
    await client.query(
      `INSERT INTO subscriptions
        (business_id, plan_id, status, current_period_end, current_period_amount, current_period_currency)
      VALUES ($1, $2, 'active', now() + interval '1 month', $3, $4)`,
      [business.id, plans[0].id, plans[0].price, plans[0].currency],
    )
  }
  await client.query(
    `UPDATE business_registration_requests
    SET status = 'approved', reviewed_by = $1, reviewed_at = now()
    WHERE id = $2`,
    [actorUserId, application.id],
  )
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
    VALUES (NULL, $1, 'platform_business_application_approved', 'business', $2, $3::jsonb)`,
    [
      actorUserId,
      business.id,
      JSON.stringify({ applicationId: application.id, businessName: application.business_name, email: application.email }),
    ],
  )
  return { business, user }
}

api.post('/auth/register-business', loginLimiter, asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const name = requireText(body.businessName, 'Business name', { max: 150 })
  const googleIdentity = body.googleCredential ? await verifyGoogleCredential(body.googleCredential) : null
  const ownerName = googleIdentity?.name || requireText(body.ownerName, 'Business owner name')
  const email = googleIdentity?.email || requireEmail(body.email)
  const phone = requireText(body.phone, 'Phone number', { max: 40 })
  const industry = requireText(body.industry, 'Business type', { max: 100 })
  const passwordHash = googleIdentity && !body.password
    ? await hashPassword(randomBytes(48).toString('base64url'))
    : await hashPassword(requireConfirmedPassword(body))

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
  res.status(202).json({ message: 'Your business registration was submitted for review. The system administrator will approve or reject it before you can sign in.' })
}))

api.get('/platform/businesses', authenticate, requireRole('platform_admin'), asyncRoute(async (_req, res) => {
  const businesses = await withDatabaseContext(async (client) => {
    const { rows: settingsRows } = await client.query(
      `SELECT value FROM platform_settings WHERE key = 'payment_grace_days' LIMIT 1`,
    )
    const graceDays = Number(settingsRows[0]?.value?.grace_days ?? 0) || 0
    const { rows } = await client.query(
      `SELECT b.id, b.name, b.email, b.phone, b.industry, b.status, b.created_at,
        b.suspended_at, b.suspended_reason,
        owner.id AS owner_user_id, owner.full_name AS owner_name, owner.email AS owner_email,
        coalesce(member_counts.user_count, 0)::integer AS user_count,
        application.status AS application_status,
        subscription.plan_name, subscription.subscription_status, subscription.current_period_end,
        subscription.fee, subscription.fee_currency,
        subscription.verified_amount, subscription.pending_count,
        payment.payment_status AS last_payment_status, payment.paid_at AS last_payment_at,
        pending_payment.pending_payment_id, pending_payment.pending_payment_amount,
        pending_payment.pending_payment_currency, pending_payment.pending_payment_method,
        pending_payment.pending_payment_reference, pending_payment.pending_payment_created_at
      FROM businesses b
      LEFT JOIN LATERAL (
        SELECT id, full_name, email FROM users
        WHERE business_id = b.id AND role = 'business_admin'
        ORDER BY created_at, id LIMIT 1
      ) owner ON true
      LEFT JOIN LATERAL (
        SELECT count(*)::integer AS user_count FROM users WHERE business_id = b.id
      ) member_counts ON true
      LEFT JOIN LATERAL (
        SELECT status FROM business_registration_requests
        WHERE lower(email) = lower(b.email)
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) application ON true
      LEFT JOIN LATERAL (
        SELECT s.id AS subscription_id, p.name AS plan_name, s.status AS subscription_status, s.current_period_end,
          s.current_period_amount AS fee, s.current_period_currency AS fee_currency,
          s.current_period_start,
          coalesce(period_payments.verified_amount, 0) AS verified_amount,
          coalesce(period_payments.pending_count, 0)::integer AS pending_count
        FROM subscriptions s
        JOIN subscription_plans p ON p.id = s.plan_id
        LEFT JOIN LATERAL (
          SELECT sum(amount) FILTER (WHERE status = 'succeeded') AS verified_amount,
            count(*) FILTER (WHERE status = 'pending') AS pending_count
          FROM payments pay
          WHERE pay.subscription_id = s.id
            AND pay.subscription_period_start = s.current_period_start
            AND pay.subscription_period_end = s.current_period_end
        ) period_payments ON true
        WHERE s.business_id = b.id
        ORDER BY s.created_at DESC, s.id DESC LIMIT 1
      ) subscription ON true
      LEFT JOIN LATERAL (
        SELECT status AS payment_status, paid_at,
          amount AS last_payment_amount, currency AS last_payment_currency
        FROM payments WHERE business_id = b.id
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) payment ON true
      LEFT JOIN LATERAL (
        SELECT id AS pending_payment_id, amount AS pending_payment_amount,
          currency AS pending_payment_currency, payment_method AS pending_payment_method,
          provider_reference AS pending_payment_reference, created_at AS pending_payment_created_at
        FROM payments WHERE business_id = b.id AND status = 'pending'
          AND subscription_id = subscription.subscription_id
          AND subscription_period_start = subscription.current_period_start
          AND subscription_period_end = subscription.current_period_end
        ORDER BY created_at DESC, id DESC LIMIT 1
      ) pending_payment ON true
      ORDER BY b.created_at DESC, b.name`,
    )
    const nowMilliseconds = Date.now()
    const graceMilliseconds = graceDays * 86_400_000
    return rows.map((row) => {
      const hasSubscription = Boolean(row.subscription_status || row.current_period_end)
      const periodEnded = Boolean(row.current_period_end)
        && nowMilliseconds >= Date.parse(row.current_period_end)
      const remainingBalance = Math.max(0, Number(row.fee ?? 0) - Number(row.verified_amount ?? 0))
      const overdue = hasSubscription
        && remainingBalance > 0
        && (['past_due', 'expired'].includes(row.subscription_status)
          || (periodEnded && nowMilliseconds > Date.parse(row.current_period_end) + graceMilliseconds))
      let paymentStatus = null
      if (row.status === 'suspended') paymentStatus = 'suspended'
      else if (overdue) paymentStatus = 'overdue'
      else if (row.pending_count > 0 || row.pending_payment_id || (periodEnded && remainingBalance > 0)) paymentStatus = 'pending'
      else if (hasSubscription) paymentStatus = 'paid'
      const fee = Number(row.fee ?? 0)
      return {
        id: row.id,
        name: row.name,
        email: row.email,
        phone: row.phone,
        industry: row.industry,
        status: row.status,
        createdAt: row.created_at,
        registeredAt: row.created_at,
        ownerUserId: row.owner_user_id,
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
        userCount: row.user_count,
        approvalStatus: row.application_status || null,
        planName: row.plan_name,
        subscriptionStatus: row.subscription_status,
        currentPeriodEnd: row.current_period_end,
        subscriptionOverdue: overdue,
        fee,
        feeCurrency: row.fee_currency || 'TZS',
        paymentStatus,
        dueDate: row.current_period_end,
        nextPaymentDate: row.current_period_end,
        outstandingBalance: periodEnded ? remainingBalance : 0,
        lastPaymentStatus: row.last_payment_status,
        lastPaymentAt: row.last_payment_at,
        lastPaymentAmount: row.last_payment_amount == null ? null : Number(row.last_payment_amount),
        lastPaymentCurrency: row.last_payment_currency,
        suspendedAt: row.suspended_at,
        suspendedReason: row.suspended_reason,
        pendingPayment: row.pending_payment_id ? {
          id: row.pending_payment_id,
          amount: Number(row.pending_payment_amount),
          currency: row.pending_payment_currency,
          method: row.pending_payment_method,
          reference: row.pending_payment_reference,
          createdAt: row.pending_payment_created_at,
        } : null,
      }
    })
  }, { platformAdmin: true })
  res.json({ businesses })
}))

api.patch('/platform/businesses/:id', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const id = requireUuid(req.params.id, 'Business ID')
  const body = requireObject(req.body)
  if (!['active', 'suspended'].includes(body.status)) {
    throw new HttpError(400, 'Business status must be active or suspended.')
  }
  const reason = body.status === 'suspended'
    ? requireText(body.reason, 'Suspension reason', { max: 200 })
    : null

  const business = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `UPDATE businesses SET status = $1, updated_at = now(),
        suspended_at = CASE WHEN $1 = 'suspended' THEN now() ELSE NULL END,
        suspended_reason = CASE WHEN $1 = 'suspended' THEN $3 ELSE NULL END
      WHERE id = $2 AND status IN ('active', 'suspended')
      RETURNING id, name, status`,
      [body.status, id, reason],
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
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $3, $2, 'business', $1, $4::jsonb)`,
      [
        id,
        `platform_business_${body.status}`,
        req.user.id,
        JSON.stringify({ businessId: id, ...(reason ? { reason } : {}) }),
      ],
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
    await client.query(
      `DELETE FROM business_registration_requests WHERE lower(email) = lower($1)`,
      [businesses[0].email],
    )
    await client.query('DELETE FROM businesses WHERE id = $1', [id])
  }, { platformAdmin: true })

  res.status(204).end()
}))

api.get('/platform/subscription-settings', authenticate, requireRole('platform_admin'), asyncRoute(async (_req, res) => {
  const settings = await withDatabaseContext(async (client) => {
    const { rows: planRows } = await client.query(
      `SELECT id, name, price, currency FROM subscription_plans
      WHERE active = true AND billing_period = 'monthly'
      ORDER BY (name = 'Business Growth') DESC, created_at, id LIMIT 1`,
    )
    if (!planRows[0]) throw new HttpError(404, 'No active monthly subscription plan is configured.')
    const { rows: graceRows } = await client.query(
      `SELECT value FROM platform_settings WHERE key = 'payment_grace_days' LIMIT 1`,
    )
    return {
      monthlyFee: Number(planRows[0].price),
      currency: planRows[0].currency,
      graceDays: Number(graceRows[0]?.value?.grace_days ?? 0) || 0,
      planName: planRows[0].name,
    }
  }, { platformAdmin: true })
  res.json({ settings })
}))

api.post('/platform/subscription-settings', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const body = requireObject(req.body)
  const monthlyFee = requireAmount(body.monthlyFee, 'Monthly subscription fee', { min: 0, exclusiveMin: true })
  const currency = requireText(body.currency, 'Currency')
  if (currency.length !== 3 || !isSupportedCurrency(currency)) {
    throw new HttpError(400, 'Choose a supported subscription currency.')
  }
  const graceDays = requireInteger(body.graceDays, 'Payment grace days', { min: 0, max: 365 })

  const settings = await withDatabaseContext(async (client) => {
    const { rows: planRows } = await client.query(
      `SELECT id, name FROM subscription_plans
      WHERE active = true AND billing_period = 'monthly'
      ORDER BY (name = 'Business Growth') DESC, created_at, id LIMIT 1`,
    )
    if (!planRows[0]) throw new HttpError(404, 'No active monthly subscription plan is configured.')
    await client.query(
      'UPDATE subscription_plans SET price = $1, currency = $2 WHERE id = $3',
      [monthlyFee, currency, planRows[0].id],
    )
    await client.query(
      `INSERT INTO platform_settings (key, value, updated_at)
      VALUES ('payment_grace_days', $1::jsonb, now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [JSON.stringify({ grace_days: graceDays })],
    )
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $1, 'platform_subscription_settings_updated', 'platform_settings', NULL, $2::jsonb)`,
      [req.user.id, JSON.stringify({ monthlyFee, currency, graceDays, planName: planRows[0].name })],
    )
    return { monthlyFee, currency, graceDays, planName: planRows[0].name }
  }, { platformAdmin: true })

  res.json({ settings })
}))

api.post('/platform/businesses/:id/payments', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const businessId = requireUuid(req.params.id, 'Business ID')
  const body = requireObject(req.body)
  const amount = requireAmount(body.amount, 'Payment amount', { min: 0, exclusiveMin: true })
  const currency = requireText(body.currency, 'Currency')
  if (currency.length !== 3 || !isSupportedCurrency(currency)) {
    throw new HttpError(400, 'Choose a supported payment currency.')
  }
  if (!paymentMethods.includes(body.method)) {
    throw new HttpError(400, 'Choose a valid payment method.')
  }
  const reference = body.reference ? requireText(body.reference, 'Payment reference', { max: 100 }) : null

  const payment = await withDatabaseContext(async (client) => {
    const { rows: businessRows } = await client.query(
      'SELECT id, name FROM businesses WHERE id = $1',
      [businessId],
    )
    if (!businessRows[0]) throw new HttpError(404, 'Customer business not found.')
    const { rows: subscriptionRows } = await client.query(
      `SELECT id, current_period_start, current_period_end, current_period_amount, current_period_currency
      FROM subscriptions WHERE business_id = $1
      ORDER BY created_at DESC, id DESC LIMIT 1 FOR UPDATE`,
      [businessId],
    )
    const subscription = subscriptionRows[0] || null
    if (subscription && currency !== subscription.current_period_currency) {
      throw new HttpError(400, `Payment currency must match the current invoice currency (${subscription.current_period_currency.trim()}).`)
    }
    if (subscription) {
      const { rows: totals } = await client.query(
        `SELECT coalesce(sum(amount), 0) AS reserved_amount
        FROM payments
        WHERE subscription_id = $1
          AND subscription_period_start = (
            SELECT current_period_start FROM subscriptions WHERE id = $1
          )
          AND subscription_period_end = (
            SELECT current_period_end FROM subscriptions WHERE id = $1
          )
          AND status IN ('pending', 'succeeded')`,
        [subscription.id],
      )
      if (Number(totals[0].reserved_amount) + amount > Number(subscription.current_period_amount)) {
        throw new HttpError(400, 'Payment exceeds the outstanding subscription invoice balance.')
      }
    }
    const { rows: paymentRows } = await client.query(
      `INSERT INTO payments
        (business_id, subscription_id, amount, currency, payment_method, provider_reference, status,
          subscription_period_start, subscription_period_end)
      VALUES (
        $1, $2, $3, $4, $5, $6, 'pending',
        (SELECT current_period_start FROM subscriptions WHERE id = $2),
        (SELECT current_period_end FROM subscriptions WHERE id = $2)
      )
      RETURNING id, business_id, amount, currency, payment_method, provider_reference, status, created_at`,
      [businessId, subscription?.id || null, amount, currency, body.method, reference],
    )
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $1, 'platform_payment_recorded', 'payment', $2, $3::jsonb)`,
      [req.user.id, paymentRows[0].id, JSON.stringify({ businessId, amount, currency, method: body.method, reference })],
    )
    return paymentRows[0]
  }, { platformAdmin: true })

  res.json({
    message: 'Payment recorded and awaiting verification.',
    payment: { id: payment.id, amount: Number(payment.amount), currency: payment.currency, status: payment.status },
  })
}))

api.post('/platform/payments/:paymentId/verify', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const paymentId = requireUuid(req.params.paymentId, 'Payment ID')
  const result = await withDatabaseContext(async (client) => {
    const { rows: paymentRows } = await client.query(
      `SELECT pay.id, pay.status, pay.business_id, pay.amount, pay.currency,
        (pay.subscription_period_start = s.current_period_start
          AND pay.subscription_period_end = s.current_period_end) AS current_period_match,
        s.id AS subscription_id
      FROM payments pay
      LEFT JOIN subscriptions s ON s.id = pay.subscription_id AND s.business_id = pay.business_id
      WHERE pay.id = $1
      FOR UPDATE OF pay`,
      [paymentId],
    )
    if (!paymentRows[0]) throw new HttpError(404, 'Payment not found.')
    if (paymentRows[0].status !== 'pending') {
      throw new HttpError(409, 'Only pending payments can be verified.')
    }
    const payment = paymentRows[0]
    let subscription = null
    let periodExtended = false
    if (payment.subscription_id) {
      const { rows: subscriptions } = await client.query(
        `SELECT s.id, s.current_period_start, s.current_period_end, s.current_period_amount,
          s.current_period_currency, p.price AS next_period_amount,
          p.currency AS next_period_currency, p.billing_period
        FROM subscriptions s
        JOIN subscription_plans p ON p.id = s.plan_id
        WHERE s.id = $1 AND s.business_id = $2
        FOR UPDATE OF s`,
        [payment.subscription_id, payment.business_id],
      )
      subscription = subscriptions[0] || null
      if (subscription && !payment.current_period_match) {
        throw new HttpError(409, 'This payment belongs to a different subscription period.')
      }
      if (subscription && payment.currency.trim() !== subscription.current_period_currency.trim()) {
        throw new HttpError(409, 'This payment currency does not match the subscription invoice.')
      }
    }
    await client.query(
      `UPDATE payments SET status = 'succeeded', paid_at = coalesce(paid_at, now())
      WHERE id = $1`,
      [paymentId],
    )
    if (subscription) {
      const { rows: totals } = await client.query(
        `SELECT coalesce(sum(amount), 0) AS paid_amount
        FROM payments
        WHERE subscription_id = $1
          AND subscription_period_start = (
            SELECT current_period_start FROM subscriptions WHERE id = $1
          )
          AND subscription_period_end = (
            SELECT current_period_end FROM subscriptions WHERE id = $1
          )
          AND status = 'succeeded'`,
        [subscription.id],
      )
      if (Number(totals[0].paid_amount) >= Number(subscription.current_period_amount)) {
        const nextPeriodStart = new Date(Math.max(Date.parse(subscription.current_period_end), Date.now()))
        const nextPeriodEnd = addBillingPeriod(nextPeriodStart, subscription.billing_period)
        await client.query(
          `UPDATE subscriptions
          SET status = 'active', current_period_start = $2, current_period_end = $3,
            current_period_amount = $4, current_period_currency = $5, updated_at = now()
          WHERE id = $1 AND status IN ('trial', 'active', 'past_due', 'expired')`,
          [
            subscription.id,
            nextPeriodStart.toISOString(),
            nextPeriodEnd.toISOString(),
            subscription.next_period_amount,
            subscription.next_period_currency,
          ],
        )
        periodExtended = true
      }
    }
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $1, 'platform_payment_verified', 'payment', $2, $3::jsonb)`,
      [req.user.id, paymentId, JSON.stringify({ businessId: payment.business_id, amount: Number(payment.amount), currency: payment.currency })],
    )
    return {
      id: payment.id,
      businessId: payment.business_id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: 'succeeded',
      periodExtended,
    }
  }, { platformAdmin: true })
  res.json({
    message: result.periodExtended
      ? 'Payment verified. The invoice is paid and the subscription period was extended.'
      : 'Payment verified and applied to the current subscription invoice.',
    payment: result,
  })
}))

api.get('/platform/applications', authenticate, requireRole('platform_admin'), asyncRoute(async (_req, res) => {
  const applications = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `SELECT r.id, r.business_name, r.owner_name, r.email, r.phone, r.industry,
        r.status, r.created_at, r.reviewed_at,
        reviewer.full_name AS reviewed_by_name
      FROM business_registration_requests r
      LEFT JOIN users reviewer ON reviewer.id = r.reviewed_by
      ORDER BY
        CASE r.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
        r.created_at DESC, r.id DESC`,
    )
    return rows.map((row) => ({
      id: row.id,
      businessName: row.business_name,
      ownerName: row.owner_name,
      email: row.email,
      phone: row.phone,
      industry: row.industry,
      status: row.status,
      createdAt: row.created_at,
      reviewedAt: row.reviewed_at,
      reviewedByName: row.reviewed_by_name,
    }))
  }, { platformAdmin: true })
  res.json({ applications })
}))

api.post('/platform/applications/:id/approve', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const id = requireUuid(req.params.id, 'Application ID')
  const result = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `SELECT id, business_name, owner_name, email, phone, industry, password_hash, google_sub, status
      FROM business_registration_requests WHERE id = $1 FOR UPDATE`,
      [id],
    )
    if (!rows[0]) throw new HttpError(404, 'Business application not found.')
    if (rows[0].status !== 'pending') throw new HttpError(409, 'Only pending applications can be approved.')
    return provisionApprovedApplication(client, rows[0], req.user.id)
  }, { platformAdmin: true })
  res.json({
    message: `${result.business.name} was approved and its owner can now sign in.`,
    business: { id: result.business.id, name: result.business.name, status: result.business.status },
    user: { id: result.user.id, fullName: result.user.full_name, email: result.user.email, role: result.user.role },
  })
}))

api.post('/platform/applications/:id/reject', authenticate, requireRole('platform_admin'), asyncRoute(async (req, res) => {
  const id = requireUuid(req.params.id, 'Application ID')
  const application = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      'SELECT id, business_name, email, status FROM business_registration_requests WHERE id = $1 FOR UPDATE',
      [id],
    )
    if (!rows[0]) throw new HttpError(404, 'Business application not found.')
    if (rows[0].status !== 'pending') throw new HttpError(409, 'Only pending applications can be rejected.')
    await client.query(
      `UPDATE business_registration_requests
      SET status = 'rejected', reviewed_by = $1, reviewed_at = now()
      WHERE id = $2`,
      [req.user.id, id],
    )
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $1, 'platform_business_application_rejected', 'business_application', $2, $3::jsonb)`,
      [req.user.id, id, JSON.stringify({ businessName: rows[0].business_name, email: rows[0].email })],
    )
    return rows[0]
  }, { platformAdmin: true })
  res.json({ message: `The application from ${application.business_name} was rejected. The applicant will not be able to sign in.` })
}))

api.patch('/platform/users/:id/password', authenticate, requireRole('platform_admin'), passwordResetLimiter, asyncRoute(async (req, res) => {
  const id = requireUuid(req.params.id, 'User ID')
  const body = requireObject(req.body)
  const password = requireConfirmedPassword(body)

  await withDatabaseContext(async (client) => {
    const { rows: owners } = await client.query(
      "SELECT password_hash FROM users WHERE id = $1 AND role = 'platform_admin' AND status = 'active'",
      [req.user.id],
    )
    if (typeof body.ownerPassword !== 'string' || !owners[0]
      || !await verifyPassword(body.ownerPassword, owners[0].password_hash)) {
      throw new HttpError(403, 'The owner password is incorrect.')
    }

    const passwordHash = await hashPassword(password)
    const { rows } = await client.query(
      `UPDATE users SET password_hash = $1, updated_at = now()
      WHERE id = $2 AND role = 'business_admin'
      RETURNING id, full_name, email, business_id`,
      [passwordHash, id],
    )
    if (!rows[0]) throw new HttpError(404, 'Business administrator not found.')

    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [id])
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES (NULL, $1, 'platform_business_admin_password_reset', 'user', $2, $3::jsonb)`,
      [req.user.id, id, JSON.stringify({ email: rows[0].email, businessId: rows[0].business_id })],
    )
  }, { platformAdmin: true })

  res.status(204).end()
}))

api.get('/dashboard', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const chartRange = req.query.range || 'today'
  const chartDate = req.query.date || new Date().toISOString().slice(0, 10)
  const customStartDate = req.query.startDate
  const customEndDate = req.query.endDate
  if (!['today', 'day', 'week', 'month', '3months', 'year', 'lastMonth', '7days', '30days', '90days', 'custom'].includes(chartRange)) {
    throw new HttpError(400, 'Business performance range is invalid.')
  }
  if (typeof chartDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(chartDate)
    || Number.isNaN(Date.parse(`${chartDate}T00:00:00.000Z`))
    || new Date(`${chartDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== chartDate) {
    throw new HttpError(400, 'Business performance date is invalid.')
  }
  if (chartRange === 'custom') {
    const isDate = (value) => typeof value === 'string'
      && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
      && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
    if (!isDate(customStartDate) || !isDate(customEndDate)
      || customStartDate > customEndDate
      || (Date.parse(`${customEndDate}T00:00:00.000Z`) - Date.parse(`${customStartDate}T00:00:00.000Z`)) / 86_400_000 > 365) {
      throw new HttpError(400, 'Custom dashboard range must be valid and no longer than 366 days.')
    }
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
      UNION ALL
      SELECT 'cashIncome', s.currency, sum(s.total), s.exchange_rates, bool_or(s.fx_rate_is_stale)
      FROM sales s CROSS JOIN tenant t
      WHERE s.business_id = t.id
        AND s.created_at >= (date_trunc('month', t.local_day)::date::timestamp AT TIME ZONE t.timezone)
        AND s.created_at < ((t.local_day + 1)::timestamp AT TIME ZONE t.timezone)
        AND s.status = 'completed' AND s.payment_status = 'paid'
        AND NOT EXISTS (
          SELECT 1 FROM debt_transactions dt
          WHERE dt.business_id = s.business_id AND dt.sale_id = s.id
        )
      GROUP BY s.currency, s.exchange_rates
      UNION ALL
      SELECT 'cashIncome', dp.currency, sum(dp.amount), dp.exchange_rates, bool_or(dp.fx_rate_is_stale)
      FROM debt_payments dp CROSS JOIN tenant t
      WHERE dp.business_id = t.id
        AND dp.received_at >= (date_trunc('month', t.local_day)::date::timestamp AT TIME ZONE t.timezone)
        AND dp.received_at < ((t.local_day + 1)::timestamp AT TIME ZONE t.timezone)
      GROUP BY dp.currency, dp.exchange_rates
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
  let cashIncome = 0
  const fxWarnings = new Set()
  for (const row of metricRows) {
    const amount = convertRecordedAmount(row.amount, row.currency, displayCurrency, row.exchange_rates)
    if (row.metric === 'cashIncome') cashIncome += amount
    else metrics[row.metric] += amount
    if (row.rates_stale) fxWarnings.add('One or more transactions were recorded with an outdated exchange-rate snapshot.')
  }
  metrics.netProfit = metrics.profit - metrics.expenses
  metrics.cashFlow = cashIncome - metrics.expenses
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
          WHEN '7days' THEN $3::date - 6
          WHEN '30days' THEN $3::date - 29
          WHEN '90days' THEN $3::date - 89
          WHEN 'custom' THEN $4::date
          WHEN 'month' THEN date_trunc('month', $3::date)::date
          WHEN '3months' THEN date_trunc('month', $3::date - interval '2 months')::date
          WHEN 'year' THEN date_trunc('month', $3::date - interval '11 months')::date
          WHEN 'lastMonth' THEN date_trunc('month', $3::date - interval '1 month')::date
        END AS start_day,
        CASE $2
          WHEN 'today' THEN $3::date + 1
          WHEN 'day' THEN $3::date + 1
          WHEN 'week' THEN $3::date + 1
          WHEN '7days' THEN $3::date + 1
          WHEN '30days' THEN $3::date + 1
          WHEN '90days' THEN $3::date + 1
          WHEN 'custom' THEN $5::date + 1
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
    [req.user.businessId, chartRange, chartDate, customStartDate || chartDate, customEndDate || chartDate],
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
  const { rows: expenseCategoryRows } = await client.query(
    `WITH tenant AS (
      SELECT id FROM businesses WHERE id = $1
    ), bounds AS (
      SELECT
        CASE $2
          WHEN 'today' THEN $3::date
          WHEN 'day' THEN $3::date
          WHEN 'week' THEN $3::date - 6
          WHEN '7days' THEN $3::date - 6
          WHEN '30days' THEN $3::date - 29
          WHEN '90days' THEN $3::date - 89
          WHEN 'month' THEN date_trunc('month', $3::date)::date
          WHEN '3months' THEN date_trunc('month', $3::date - interval '2 months')::date
          WHEN 'year' THEN date_trunc('month', $3::date - interval '11 months')::date
          WHEN 'lastMonth' THEN date_trunc('month', $3::date - interval '1 month')::date
          WHEN 'custom' THEN $4::date
        END AS start_day,
        CASE $2
          WHEN 'month' THEN date_trunc('month', $3::date + interval '1 month')::date
          WHEN '3months' THEN date_trunc('month', $3::date + interval '1 month')::date
          WHEN 'year' THEN date_trunc('month', $3::date + interval '1 month')::date
          WHEN 'lastMonth' THEN date_trunc('month', $3::date)::date
          WHEN 'custom' THEN $5::date + 1
          ELSE $3::date + 1
        END AS end_day,
        tenant.id AS business_id
      FROM tenant
    )
    SELECT e.category, e.currency, sum(e.amount) AS amount, e.exchange_rates, bool_or(e.fx_rate_is_stale) AS rates_stale
    FROM expenses e CROSS JOIN bounds
    WHERE e.business_id = bounds.business_id
      AND e.expense_date >= bounds.start_day AND e.expense_date < bounds.end_day
    GROUP BY e.category, e.currency, e.exchange_rates ORDER BY e.category`,
    [req.user.businessId, chartRange, chartDate, customStartDate || chartDate, customEndDate || chartDate],
  )
  const expenseCategoryMap = new Map()
  for (const row of expenseCategoryRows) {
    const amount = convertRecordedAmount(row.amount, row.currency, displayCurrency, row.exchange_rates)
    expenseCategoryMap.set(row.category, (expenseCategoryMap.get(row.category) || 0) + amount)
    if (row.rates_stale) fxWarnings.add('One or more transactions were recorded with an outdated exchange-rate snapshot.')
  }
  const expenseTotal = [...expenseCategoryMap.values()].reduce((sum, amount) => sum + amount, 0)
  const expenseBreakdown = [...expenseCategoryMap].map(([category, amount]) => ({
    category,
    amount,
    percentage: expenseTotal > 0 ? amount / expenseTotal * 100 : 0,
  }))
  const [{ rows: recentSales }, { rows: recentExpenses }] = await Promise.all([
    client.query(
      `SELECT s.id, s.receipt_number, s.customer_name, s.total, s.currency, s.exchange_rates, s.created_at,
        s.payment_status, coalesce(string_agg(si.product_name || ' ×' || si.quantity, ', ' ORDER BY si.created_at), '') AS description
      FROM sales s LEFT JOIN sale_items si ON si.business_id = s.business_id AND si.sale_id = s.id
      WHERE s.business_id = $1 AND s.status = 'completed'
      GROUP BY s.id ORDER BY s.created_at DESC LIMIT 100`,
      [req.user.businessId],
    ),
    client.query(
      `SELECT id, category, description, amount, currency, exchange_rates, expense_date, created_at
      FROM expenses WHERE business_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [req.user.businessId],
    ),
  ])
  const recentTransactions = [
    ...recentSales.map((row) => ({
      id: row.receipt_number,
      description: row.description || row.customer_name,
      date: row.created_at,
      category: 'Sales',
      amount: convertRecordedAmount(row.total, row.currency, displayCurrency, row.exchange_rates),
      status: row.payment_status,
    })),
    ...recentExpenses.map((row) => ({
      id: row.id,
      description: row.description,
      date: row.expense_date,
      category: row.category,
      amount: -convertRecordedAmount(row.amount, row.currency, displayCurrency, row.exchange_rates),
      status: 'recorded',
    })),
  ].sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime()).slice(0, 100)
  const { rows: subscriptionRows } = await client.query(
    `SELECT p.name AS plan_name, s.current_period_amount AS price,
      s.current_period_currency AS currency, p.billing_period, s.status, s.current_period_end
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
    expenseBreakdown,
    recentTransactions,
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
    `SELECT id, name, email, phone, industry, currency, timezone, status,
      logo_updated_at AS "logoUpdatedAt"
    FROM businesses WHERE id = $1`,
    [req.user.businessId],
  )
  if (!rows[0]) throw new HttpError(404, 'Business not found.')
  res.json({ business: rows[0] })
}))

api.get('/business/logo', authenticate, asyncRoute(async (req, res) => {
  const result = await withDatabaseContext(
    (client) => client.query(
      `SELECT logo_data, logo_mime_type FROM businesses WHERE id = $1`,
      [req.user.businessId],
    ),
    { businessId: req.user.businessId },
  )
  if (!result.rows[0]) throw new HttpError(404, 'Business not found.')
  if (!result.rows[0].logo_data) throw new HttpError(404, 'This business has no logo.')
  res.set({
    'Content-Type': result.rows[0].logo_mime_type,
    'Cache-Control': 'private, no-cache',
    'X-Content-Type-Options': 'nosniff',
  }).send(result.rows[0].logo_data)
}))

api.put(
  '/business/logo',
  authenticate,
  requireRole('business_admin'),
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: maxBusinessLogoBytes }),
  tenantRoute(async (req, res, client) => {
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      throw new HttpError(400, 'Choose a PNG, JPEG, or WebP logo to upload.')
    }
    const detectedMimeType = detectBusinessLogoMimeType(req.body)
    if (!detectedMimeType || detectedMimeType !== req.get('content-type')) {
      throw new HttpError(400, 'The uploaded file must be a valid PNG, JPEG, or WebP image.')
    }
    const { rows } = await client.query(
      `UPDATE businesses
      SET logo_data = $1, logo_mime_type = $2, logo_updated_at = now(), updated_at = now()
      WHERE id = $3
      RETURNING logo_updated_at AS "logoUpdatedAt"`,
      [req.body, detectedMimeType, req.user.businessId],
    )
    if (!rows[0]) throw new HttpError(404, 'Business not found.')
    await client.query(
      `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
      VALUES ($1, $2, 'business_logo_updated', 'business', $1, $3::jsonb)`,
      [req.user.businessId, req.user.id, JSON.stringify({ mimeType: detectedMimeType, sizeBytes: req.body.length })],
    )
    res.json({ logoUpdatedAt: rows[0].logoUpdatedAt })
  }),
)

api.delete('/business/logo', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const { rows } = await client.query(
    `UPDATE businesses
    SET logo_data = NULL, logo_mime_type = NULL, logo_updated_at = NULL, updated_at = now()
    WHERE id = $1
    RETURNING id`,
    [req.user.businessId],
  )
  if (!rows[0]) throw new HttpError(404, 'Business not found.')
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id)
    VALUES ($1, $2, 'business_logo_removed', 'business', $1)`,
    [req.user.businessId, req.user.id],
  )
  res.status(204).end()
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
    RETURNING id, name, email, phone, industry, currency, timezone, status,
      logo_updated_at AS "logoUpdatedAt"`,
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
  res.status(201).json({ sale: {
    ...mapSale({
    ...sale,
    currency: saleCurrency,
    display_currency: saleCurrency,
    exchange_rates: savedRates,
    items: products.map((product) => `${product.name} ×${quantities.get(product.id)}`).join(', '),
    gross_profit: products.reduce((sum, product) => sum + (product.sale_selling_price - product.sale_buying_price) * quantities.get(product.id), 0),
    }),
    tshAmount: convertRecordedAmount(sale.total, saleCurrency, 'TZS', savedRates),
  }, ratesStale: exchangeData.isStale })
}))

// ---------------------------------------------------------------------------
// Customer Debts (Credit Sales)
// One customer profile per business with many debt transactions and payments.
// ---------------------------------------------------------------------------

const DEBT_STAFF = ['business_admin', 'sales_agent']

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100
}

// Convert with a per-record snapshot; falls back to the recorded amount when a
// snapshot is unavailable so an unreadable aggregate never blocks the page.
function convertForDisplay(amount, fromCurrency, toCurrency, rates) {
  if (!rates || typeof rates !== 'object' || fromCurrency === toCurrency) return Number(amount)
  try {
    return convertCurrency(amount, fromCurrency, toCurrency, rates)
  } catch {
    return Number(amount)
  }
}

const customerSummarySelect = `
  SELECT c.id, c.name, c.phone, c.address, c.total_debt, c.amount_paid, c.debt_status,
    c.last_transaction_at, c.created_at, c.updated_at, c.currency, c.exchange_rates,
    (SELECT count(*) FROM debt_transactions dt WHERE dt.customer_id = c.id) AS transaction_count,
    (SELECT count(*) FROM debt_payments dp WHERE dp.customer_id = c.id) AS payment_count
  FROM customers c
  WHERE c.business_id = $1 AND c.id = $2`

function mapCustomerRow(row, displayCurrency) {
  const currency = row.currency || displayCurrency || 'TZS'
  const totalDebt = round2(convertForDisplay(row.total_debt, currency, displayCurrency, row.exchange_rates))
  const amountPaid = round2(convertForDisplay(row.amount_paid, currency, displayCurrency, row.exchange_rates))
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address,
    totalDebt: round2(Math.max(0, totalDebt)),
    amountPaid: round2(Math.max(0, amountPaid)),
    balance: round2(Math.max(0, totalDebt - amountPaid)),
    debtStatus: row.debt_status,
    lastTransactionAt: row.last_transaction_at,
    transactionCount: Number(row.transaction_count || 0),
    paymentCount: Number(row.payment_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    originalCurrency: currency,
  }
}

function mapDebtTransaction(row, displayCurrency) {
  const currency = row.currency || displayCurrency || 'TZS'
  const unitPrice = round2(convertForDisplay(row.unit_price, currency, displayCurrency, row.exchange_rates))
  const totalAmount = round2(convertForDisplay(row.total_amount, currency, displayCurrency, row.exchange_rates))
  return {
    id: row.id,
    saleId: row.sale_id,
    productId: row.product_id,
    productName: row.product_display_name || row.product_name,
    recordedProductName: row.product_name,
    quantity: Number(row.quantity),
    unitPrice,
    totalAmount,
    transactionDate: row.transaction_date,
    businessDateTime: row.business_date_time,
    notes: row.notes,
    createdByName: row.created_by_name || 'Unknown',
    currency: displayCurrency,
    originalCurrency: currency,
    originalUnitPrice: Number(row.unit_price),
    originalTotalAmount: Number(row.total_amount),
  }
}

function mapDebtPayment(row, displayCurrency) {
  const currency = row.currency || displayCurrency || 'TZS'
  return {
    id: row.id,
    amount: round2(convertForDisplay(row.amount, currency, displayCurrency, row.exchange_rates)),
    receivedAt: row.received_at,
    businessDateTime: row.business_date_time,
    notes: row.notes,
    clientReference: row.client_reference,
    recordedByName: row.recorded_by_name || 'Unknown',
    currency: displayCurrency,
    originalCurrency: currency,
    originalAmount: Number(row.amount),
  }
}

async function getBusinessCurrency(client, businessId) {
  const { rows } = await client.query('SELECT currency FROM businesses WHERE id = $1', [businessId])
  if (!rows[0]) throw new HttpError(404, 'Business not found.')
  return rows[0].currency
}

// Recompute a customer's cached balances and keep its credit sales in sync.
async function refreshCustomerBalances(client, customerId) {
  const { rows } = await client.query(
    `SELECT
      COALESCE((SELECT sum(dt.total_amount) FROM debt_transactions dt WHERE dt.customer_id = c.id), 0) AS total_debt,
      COALESCE((SELECT sum(dp.amount) FROM debt_payments dp WHERE dp.customer_id = c.id), 0) AS amount_paid,
      (SELECT max(dt.transaction_date) FROM debt_transactions dt WHERE dt.customer_id = c.id) AS last_transaction_at,
      (SELECT dt.currency FROM debt_transactions dt WHERE dt.customer_id = c.id
        ORDER BY dt.transaction_date DESC, dt.created_at DESC LIMIT 1) AS last_currency,
      (SELECT dt.exchange_rates FROM debt_transactions dt WHERE dt.customer_id = c.id
        ORDER BY dt.transaction_date DESC, dt.created_at DESC LIMIT 1) AS last_rates
     FROM customers c WHERE c.id = $1`,
    [customerId],
  )
  const row = rows[0]
  const total = Number(row.total_debt)
  const paid = Number(row.amount_paid)
  const status = total <= 0 ? 'unpaid' : paid + 0.005 >= total ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
  const lastRates = row.last_rates && typeof row.last_rates === 'object' ? row.last_rates : null
  await client.query(
    `UPDATE customers
      SET total_debt = $2, amount_paid = $3, debt_status = $4, last_transaction_at = $5,
        updated_at = now(), currency = COALESCE($6, currency), exchange_rates = $7
     WHERE id = $1`,
    [customerId, total, paid, status, row.last_transaction_at, row.last_currency || null,
      lastRates ? JSON.stringify(lastRates) : null],
  )
  await client.query(
    `UPDATE sales SET payment_status = CASE
        WHEN $2 + 0.005 >= $3 THEN 'paid'
        WHEN $2 > 0 THEN 'partial'
        ELSE 'unpaid' END
     WHERE status = 'completed'
       AND id IN (SELECT sale_id FROM debt_transactions WHERE customer_id = $1 AND sale_id IS NOT NULL)`,
    [customerId, paid, total],
  )
}

async function loadCustomerDetail(client, customerId, businessId, displayCurrency) {
  const { rows } = await client.query(customerSummarySelect, [businessId, customerId])
  if (!rows[0]) throw new HttpError(404, 'Customer not found.')
  const customer = mapCustomerRow(rows[0], displayCurrency)
  const { rows: transactions } = await client.query(
    `SELECT dt.id, dt.sale_id, dt.product_id, dt.product_name, dt.quantity, dt.unit_price, dt.total_amount,
      dt.transaction_date, dt.notes, dt.currency, dt.exchange_rates, dt.fx_rate_is_stale,
      to_char(timezone(b.timezone, dt.transaction_date), 'YYYY-MM-DD HH24:MI:SS') AS business_date_time,
      u.full_name AS created_by_name, p.name AS product_display_name
     FROM debt_transactions dt
     JOIN businesses b ON b.id = dt.business_id
     LEFT JOIN users u ON u.business_id = dt.business_id AND u.id = dt.created_by
     LEFT JOIN products p ON p.business_id = dt.business_id AND p.id = dt.product_id
     WHERE dt.business_id = $1 AND dt.customer_id = $2
     ORDER BY dt.transaction_date DESC, dt.created_at DESC`,
    [businessId, customerId],
  )
  const { rows: payments } = await client.query(
    `SELECT dp.id, dp.amount, dp.received_at, dp.notes, dp.client_reference, dp.currency,
      dp.exchange_rates, dp.fx_rate_is_stale,
      to_char(timezone(b.timezone, dp.received_at), 'YYYY-MM-DD HH24:MI:SS') AS business_date_time,
      u.full_name AS recorded_by_name
     FROM debt_payments dp
     JOIN businesses b ON b.id = dp.business_id
     LEFT JOIN users u ON u.business_id = dp.business_id AND u.id = dp.recorded_by
     WHERE dp.business_id = $1 AND dp.customer_id = $2
     ORDER BY dp.received_at DESC, dp.created_at DESC`,
    [businessId, customerId],
  )
  return {
    customer: {
      ...customer,
      transactions: transactions.map((row) => mapDebtTransaction(row, displayCurrency)),
      payments: payments.map((row) => mapDebtPayment(row, displayCurrency)),
    },
  }
}

api.get('/customers/report', authenticate, requireRole(...DEBT_STAFF), tenantRoute(async (req, res, client) => {
  const overdueDays = req.query.overdueDays === undefined
    ? 30
    : requireInteger(req.query.overdueDays, 'Overdue days', { min: 1, max: 365 })
  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  const { rows } = await client.query(
    `SELECT c.id, c.name, c.phone, c.address, c.total_debt, c.amount_paid, c.debt_status,
      c.last_transaction_at, c.currency, c.exchange_rates
     FROM customers c WHERE c.business_id = $1
     ORDER BY c.total_debt - c.amount_paid DESC`,
    [req.user.businessId],
  )
  const now = Date.now()
  const summary = {
    customers: rows.length,
    totalDebt: 0,
    totalCollected: 0,
    totalOutstanding: 0,
    byStatus: { unpaid: 0, partial: 0, paid: 0 },
    overdueCount: 0,
    overdueTotal: 0,
    overdue: [],
  }
  const customers = []
  for (const row of rows) {
    const customer = mapCustomerRow(row, displayCurrency)
    customers.push(customer)
    summary.totalDebt = round2(summary.totalDebt + customer.totalDebt)
    summary.totalCollected = round2(summary.totalCollected + customer.amountPaid)
    summary.totalOutstanding = round2(summary.totalOutstanding + customer.balance)
    summary.byStatus[customer.debtStatus] += 1
    if (customer.balance > 0.005 && customer.lastTransactionAt) {
      const ageDays = (now - new Date(customer.lastTransactionAt).getTime()) / 86_400_000
      if (ageDays >= overdueDays) {
        summary.overdueCount += 1
        summary.overdueTotal = round2(summary.overdueTotal + customer.balance)
        summary.overdue.push({ ...customer, overdueDays: Math.floor(ageDays) })
      }
    }
  }
  res.json({ summary, customers })
}))

api.get('/customers', authenticate, requireRole(...DEBT_STAFF), tenantRoute(async (req, res, client) => {
  const conditions = ['c.business_id = $1']
  const values = [req.user.businessId]
  if (req.query.search !== undefined && req.query.search !== '') {
    const search = requireText(req.query.search, 'Search', { max: 150 })
    values.push(`%${search.toLowerCase()}%`)
    conditions.push(`(lower(c.name) LIKE $${values.length} OR coalesce(lower(c.phone), '') LIKE $${values.length})`)
  }
  if (req.query.status !== undefined && req.query.status !== '') {
    if (!['unpaid', 'partial', 'paid'].includes(req.query.status)) {
      throw new HttpError(400, 'Debt status must be unpaid, partial, or paid.')
    }
    values.push(req.query.status)
    conditions.push(`c.debt_status = $${values.length}`)
  }
  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  const { rows } = await client.query(
    `SELECT c.id, c.name, c.phone, c.address, c.total_debt, c.amount_paid, c.debt_status,
      c.last_transaction_at, c.created_at, c.updated_at, c.currency, c.exchange_rates,
      (SELECT count(*) FROM debt_transactions dt WHERE dt.customer_id = c.id) AS transaction_count,
      (SELECT count(*) FROM debt_payments dp WHERE dp.customer_id = c.id) AS payment_count
     FROM customers c
     WHERE ${conditions.join(' AND ')}
     ORDER BY (c.debt_status = 'paid'), c.total_debt - c.amount_paid DESC, lower(c.name) ASC
     LIMIT 500`,
    values,
  )
  res.json({ customers: rows.map((row) => mapCustomerRow(row, displayCurrency)) })
}))

api.post('/customers', authenticate, requireRole(...DEBT_STAFF), tenantRoute(async (req, res, client) => {
  const body = requireObject(req.body)
  const name = requireText(body.name, 'Customer name', { max: 150 })
  const phone = body.phone === undefined || body.phone === '' ? null : requireText(body.phone, 'Phone number', { max: 40 })
  const address = body.address === undefined || body.address === '' ? null : requireText(body.address, 'Address', { max: 250 })
  const { rows: duplicates } = await client.query(
    `SELECT id FROM customers c WHERE c.business_id = $1
      AND lower(c.name) = $2 AND coalesce(lower(c.phone), '') = coalesce(lower($3), '')`,
    [req.user.businessId, name.toLowerCase(), phone],
  )
  if (duplicates[0]) throw new HttpError(409, `A customer named "${name}" already exists for this business.`)
  const { rows } = await client.query(
    `INSERT INTO customers (business_id, name, phone, address)
     VALUES ($1, $2, $3, $4)
     RETURNING id, name, phone, address, total_debt, amount_paid, debt_status, last_transaction_at, created_at, updated_at, currency`,
    [req.user.businessId, name, phone, address],
  )
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'customer_created', 'customer', $3, $4::jsonb)`,
    [req.user.businessId, req.user.id, rows[0].id, JSON.stringify({ name, phone })],
  )
  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  res.status(201).json({
    customer: {
      ...mapCustomerRow({ ...rows[0], transaction_count: 0, payment_count: 0, exchange_rates: null }, displayCurrency),
    },
  })
}))

api.get('/customers/:id', authenticate, requireRole(...DEBT_STAFF), tenantRoute(async (req, res, client) => {
  const customerId = requireUuid(req.params.id, 'Customer ID')
  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  const detail = await loadCustomerDetail(client, customerId, req.user.businessId, displayCurrency)
  res.json(detail)
}))

api.patch('/customers/:id', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const customerId = requireUuid(req.params.id, 'Customer ID')
  const body = requireObject(req.body)
  const { rowCount } = await client.query(
    'SELECT id FROM customers WHERE business_id = $1 AND id = $2',
    [req.user.businessId, customerId],
  )
  if (!rowCount) throw new HttpError(404, 'Customer not found.')
  const name = body.name === undefined ? undefined : requireText(body.name, 'Customer name', { max: 150 })
  const phone = body.phone === undefined ? undefined
    : (body.phone === '' ? null : requireText(body.phone, 'Phone number', { max: 40 }))
  const address = body.address === undefined ? undefined
    : (body.address === '' ? null : requireText(body.address, 'Address', { max: 250 }))
  if (name !== undefined) {
    const { rows: duplicates } = await client.query(
      `SELECT id FROM customers c WHERE c.business_id = $1 AND c.id <> $2
        AND lower(c.name) = $3 AND coalesce(lower(c.phone), '') = coalesce(lower($4), '')`,
      [req.user.businessId, customerId, name.toLowerCase(), phone === undefined ? null : phone],
    )
    if (duplicates[0]) throw new HttpError(409, `A customer named "${name}" already exists for this business.`)
  }
  const updates = []
  const params = []
  if (name !== undefined) {
    params.push(name)
    updates.push(`name = $${params.length}`)
  }
  if (phone !== undefined) {
    params.push(phone)
    updates.push(`phone = $${params.length}`)
  }
  if (address !== undefined) {
    params.push(address)
    updates.push(`address = $${params.length}`)
  }
  if (updates.length === 0) throw new HttpError(400, 'Provide at least one customer detail to update.')
  params.push(req.user.businessId, customerId)
  await client.query(
    `UPDATE customers SET ${updates.join(', ')}, updated_at = now()
     WHERE business_id = $${params.length - 1} AND id = $${params.length}`,
    params,
  )
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'customer_updated', 'customer', $3, $4::jsonb)`,
    [req.user.businessId, req.user.id, customerId, JSON.stringify({ name, phone, address })],
  )
  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  const { rows } = await client.query(customerSummarySelect, [req.user.businessId, customerId])
  res.json({ customer: mapCustomerRow(rows[0], displayCurrency) })
}))

api.delete('/customers/:id', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const customerId = requireUuid(req.params.id, 'Customer ID')
  const { rows: customers } = await client.query(
    `SELECT c.id, c.name, c.total_debt, c.amount_paid,
      (SELECT count(*) FROM debt_transactions dt WHERE dt.customer_id = c.id)::integer AS transaction_count
     FROM customers c WHERE c.business_id = $1 AND c.id = $2`,
    [req.user.businessId, customerId],
  )
  if (!customers[0]) throw new HttpError(404, 'Customer not found.')
  const customer = customers[0]
  // Return goods tied to inventory back to stock and void their credit sales.
  const { rows: openTransactions } = await client.query(
    `SELECT id, product_id, quantity FROM debt_transactions
     WHERE business_id = $1 AND customer_id = $2`,
    [req.user.businessId, customerId],
  )
  for (const transaction of openTransactions) {
    if (!transaction.product_id) continue
    await client.query(
      `UPDATE products SET quantity = quantity + $1, updated_at = now()
       WHERE business_id = $2 AND id = $3`,
      [transaction.quantity, req.user.businessId, transaction.product_id],
    )
    await client.query(
      `INSERT INTO stock_movements (business_id, product_id, performed_by, movement_type, quantity_change, unit_cost, note)
       VALUES ($1, $2, $3, 'return', $4, NULL, $5)`,
      [req.user.businessId, transaction.product_id, req.user.id, transaction.quantity, `Customer deleted (${customer.name})`],
    )
  }
  await client.query(
    `UPDATE sales SET status = 'voided', payment_status = 'refunded'
     WHERE business_id = $1
       AND id IN (SELECT sale_id FROM debt_transactions WHERE business_id = $1 AND customer_id = $2 AND sale_id IS NOT NULL)`,
    [req.user.businessId, customerId],
  )
  await client.query('DELETE FROM customers WHERE business_id = $1 AND id = $2', [req.user.businessId, customerId])
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'customer_deleted', 'customer', $3, $4::jsonb)`,
    [req.user.businessId, req.user.id, customerId,
      JSON.stringify({ name: customer.name, transactionCount: customer.transaction_count, totalDebt: Number(customer.total_debt), amountPaid: Number(customer.amount_paid) })],
  )
  res.status(204).end()
}))

api.post('/customers/:id/debt', authenticate, requireRole(...DEBT_STAFF), tenantRoute(async (req, res, client) => {
  const customerId = requireUuid(req.params.id, 'Customer ID')
  const body = requireObject(req.body)
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 100) {
    throw new HttpError(400, 'A debt entry must contain between 1 and 100 item lines.')
  }
  const { rowCount, rows: customers } = await client.query(
    'SELECT id, name, phone FROM customers WHERE business_id = $1 AND id = $2',
    [req.user.businessId, customerId],
  )
  if (!rowCount) throw new HttpError(404, 'Customer not found.')
  const customer = customers[0]
  const saleCurrency = await getBusinessCurrency(client, req.user.businessId)
  let transactionDate = new Date().toISOString()
  if (body.transactionDate !== undefined && body.transactionDate !== '') {
    const parsed = new Date(body.transactionDate)
    if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'Transaction date is invalid.')
    transactionDate = parsed.toISOString()
  }

  const productIds = [...new Set(body.items
    .filter((line) => line.productId !== undefined && line.productId !== null && String(line.productId) !== '')
    .map((line) => requireUuid(line.productId, 'Product ID')))]
  const quantityByProduct = new Map()
  for (const line of body.items) {
    const quantity = requireInteger(line.quantity, 'Quantity', { min: 1 })
    if (line.productId !== undefined && line.productId !== null && String(line.productId) !== '') {
      const productId = requireUuid(line.productId, 'Product ID')
      quantityByProduct.set(productId, (quantityByProduct.get(productId) || 0) + quantity)
    }
  }
  const { rows: products } = productIds.length > 0
    ? await client.query(
      `SELECT id, name, buying_price, selling_price, quantity, currency FROM products
       WHERE business_id = $1 AND id = ANY($2::uuid[]) AND status = 'active' ORDER BY id FOR UPDATE`,
      [req.user.businessId, productIds],
    )
    : { rows: [] }
  if (products.length !== productIds.length) throw new HttpError(400, 'One or more selected products are unavailable.')
  const exchangeData = await loadExchangeRates('Recording customer debt')
  for (const product of products) {
    const sourceCurrency = product.currency || 'TZS'
    product.sale_buying_price = convertRecordedAmount(product.buying_price, sourceCurrency, saleCurrency, exchangeData.rates)
    product.sale_selling_price = convertRecordedAmount(product.selling_price, sourceCurrency, saleCurrency, exchangeData.rates)
  }
  const productById = new Map(products.map((product) => [product.id, product]))
  for (const [productId, quantity] of quantityByProduct) {
    const product = productById.get(productId)
    if (product.quantity < quantity) throw new HttpError(409, `Not enough stock for ${product.name}.`)
  }

  let total = 0
  const lines = body.items.map((line) => {
    const quantity = requireInteger(line.quantity, 'Quantity', { min: 1 })
    const notes = line.notes === undefined || line.notes === '' ? null : requireText(line.notes, 'Notes', { max: 500 })
    if (line.productId !== undefined && line.productId !== null && String(line.productId) !== '') {
      const product = productById.get(requireUuid(line.productId, 'Product ID'))
      total += product.sale_selling_price * quantity
      return { product, quantity, unitPrice: product.sale_selling_price, notes, manual: false }
    }
    if (line.productName === undefined || line.productName === '') {
      throw new HttpError(400, 'Each debt line must include a product from inventory or an item name.')
    }
    const productName = requireText(line.productName, 'Item name', { max: 200 })
    const unitPrice = requireAmount(line.unitPrice, 'Unit price', { min: 0, exclusiveMin: true })
    total += unitPrice * quantity
    return { product: null, productName, quantity, unitPrice, notes, manual: true }
  })
  const grandTotal = requireAmount(total, 'Debt total')

  const savedRates = snapshotExchangeRates(exchangeData.rates)
  const receipt = `BMS-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex').toUpperCase()}`
  const { rows: sales } = await client.query(
    `INSERT INTO sales (
      business_id, receipt_number, customer_name, customer_phone, sold_by, status, payment_status, payment_method,
      subtotal, total, completed_at, currency, exchange_rate, converted_total, converted_currency,
      exchange_rates, fx_rate_updated_at, fx_rate_is_stale
    )
    VALUES ($1, $2, $3, $4, $5, 'completed', 'unpaid', NULL, $6, $6, now(), $7, $8, $6, $7, $9::jsonb, $10, $11)
    RETURNING id, receipt_number, created_at`,
    [
      req.user.businessId, receipt, customer.name, customer.phone, req.user.id,
      grandTotal, saleCurrency, currencyRate(saleCurrency, 'USD', exchangeData.rates),
      JSON.stringify(savedRates), exchangeData.updatedAt, exchangeData.isStale,
    ],
  )
  const saleId = sales[0].id
  const createdTransactionIds = []
  for (const line of lines) {
    const lineTotal = round2(line.unitPrice * line.quantity)
    let saleItemId = null
    if (line.product) {
      const { rows: saleItems } = await client.query(
        `INSERT INTO sale_items (business_id, sale_id, product_id, product_name, quantity, unit_buying_price, unit_selling_price, currency)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [req.user.businessId, saleId, line.product.id, line.product.name, line.quantity, line.product.sale_buying_price, line.unitPrice, saleCurrency],
      )
      saleItemId = saleItems[0].id
      await client.query(
        `UPDATE products SET quantity = quantity - $1, updated_at = now()
         WHERE business_id = $2 AND id = $3`,
        [line.quantity, req.user.businessId, line.product.id],
      )
      await client.query(
        `INSERT INTO stock_movements (business_id, product_id, performed_by, movement_type, quantity_change, unit_cost, note)
         VALUES ($1, $2, $3, 'sale', $4, $5, $6)`,
        [req.user.businessId, line.product.id, req.user.id, -line.quantity, line.product.sale_buying_price, `Credit sale ${receipt}`],
      )
    }
    const { rows: inserted } = await client.query(
      `INSERT INTO debt_transactions (
        business_id, customer_id, sale_id, sale_item_id, product_id, product_name, quantity, unit_price, total_amount,
        transaction_date, notes, created_by, currency, exchange_rate, converted_total, converted_currency,
        exchange_rates, fx_rate_updated_at, fx_rate_is_stale
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $9, $13, $15::jsonb, $16, $17)
      RETURNING id`,
      [req.user.businessId, customerId, saleId, saleItemId, line.product ? line.product.id : null,
        line.product ? line.product.name : line.productName, line.quantity, line.unitPrice, lineTotal,
        transactionDate, line.notes, req.user.id, saleCurrency, currencyRate(saleCurrency, 'USD', exchangeData.rates),
        JSON.stringify(savedRates), exchangeData.updatedAt, exchangeData.isStale],
    )
    createdTransactionIds.push(inserted[0].id)
  }
  await refreshCustomerBalances(client, customerId)
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'debt_transaction_created', 'customer', $3, $4::jsonb)`,
    [req.user.businessId, req.user.id, customerId,
      JSON.stringify({ saleId, transactionIds: createdTransactionIds, total: grandTotal, currency: saleCurrency, receipt })],
  )
  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  const detail = await loadCustomerDetail(client, customerId, req.user.businessId, displayCurrency)
  res.status(201).json({
    customer: detail.customer,
    creditSale: { id: saleId, receiptNumber: receipt },
    createdTransactionIds,
  })
}))

api.post('/customers/:id/payments', authenticate, requireRole(...DEBT_STAFF), tenantRoute(async (req, res, client) => {
  const customerId = requireUuid(req.params.id, 'Customer ID')
  const body = requireObject(req.body)
  const { rows: customers } = await client.query(
    'SELECT id, name, total_debt, amount_paid FROM customers WHERE business_id = $1 AND id = $2',
    [req.user.businessId, customerId],
  )
  if (!customers[0]) throw new HttpError(404, 'Customer not found.')
  const customer = customers[0]
  const outstanding = round2(Number(customer.total_debt) - Number(customer.amount_paid))
  const amount = requireAmount(body.amount, 'Payment amount', { min: 0, exclusiveMin: true })
  if (amount > outstanding + 0.005) {
    throw new HttpError(409, `Payment of ${amount.toFixed(2)} exceeds the outstanding balance of ${outstanding.toFixed(2)}.`)
  }
  let receivedAt = new Date().toISOString()
  if (body.receivedAt !== undefined && body.receivedAt !== '') {
    const parsed = new Date(body.receivedAt)
    if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'Payment date is invalid.')
    receivedAt = parsed.toISOString()
  }
  const notes = body.notes === undefined || body.notes === '' ? null : requireText(body.notes, 'Notes', { max: 500 })
  const clientReference = body.clientReference === undefined || body.clientReference === ''
    ? null
    : requireText(body.clientReference, 'Payment reference', { max: 100 })

  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  if (clientReference) {
    const { rows: existing } = await client.query(
      'SELECT id FROM debt_payments WHERE business_id = $1 AND client_reference = $2',
      [req.user.businessId, clientReference],
    )
    if (existing[0]) {
      const detail = await loadCustomerDetail(client, customerId, req.user.businessId, displayCurrency)
      const { rows: payments } = await client.query(
        `SELECT dp.id, dp.amount, dp.received_at, dp.notes, dp.client_reference, dp.currency,
          dp.exchange_rates, dp.fx_rate_is_stale,
          to_char(timezone(b.timezone, dp.received_at), 'YYYY-MM-DD HH24:MI:SS') AS business_date_time,
          u.full_name AS recorded_by_name
         FROM debt_payments dp
         JOIN businesses b ON b.id = dp.business_id
         LEFT JOIN users u ON u.business_id = dp.business_id AND u.id = dp.recorded_by
         WHERE dp.business_id = $1 AND dp.id = $2`,
        [req.user.businessId, existing[0].id],
      )
      return res.json({ customer: detail.customer, payment: mapDebtPayment(payments[0], displayCurrency), duplicate: true })
    }
  }

  const paymentCurrency = displayCurrency
  const exchangeData = await loadExchangeRates('Recording debt payment')
  const savedRates = snapshotExchangeRates(exchangeData.rates)
  const { rows: payments } = await client.query(
    `INSERT INTO debt_payments (
      business_id, customer_id, amount, received_at, notes, recorded_by, client_reference,
      currency, exchange_rate, converted_amount, converted_currency, exchange_rates, fx_rate_updated_at, fx_rate_is_stale
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $3, $8, $10::jsonb, $11, $12)
    RETURNING id, amount, received_at, notes, client_reference, currency`,
    [req.user.businessId, customerId, amount, receivedAt, notes, req.user.id, clientReference,
      paymentCurrency, currencyRate(paymentCurrency, 'USD', exchangeData.rates),
      JSON.stringify(savedRates), exchangeData.updatedAt, exchangeData.isStale],
  )
  await refreshCustomerBalances(client, customerId)
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'debt_payment_recorded', 'customer', $3, $4::jsonb)`,
    [req.user.businessId, req.user.id, customerId,
      JSON.stringify({ paymentId: payments[0].id, amount, currency: paymentCurrency, clientReference })],
  )
  const detail = await loadCustomerDetail(client, customerId, req.user.businessId, displayCurrency)
  const payment = detail.customer.payments.find((row) => row.id === payments[0].id) || payments[0]
  res.status(201).json({ customer: detail.customer, payment })
}))

api.patch('/customers/:id/transactions/:transactionId', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const customerId = requireUuid(req.params.id, 'Customer ID')
  const transactionId = requireUuid(req.params.transactionId, 'Debt transaction ID')
  const body = requireObject(req.body)
  const { rowCount, rows: customers } = await client.query(
    'SELECT id, name, total_debt, amount_paid FROM customers WHERE business_id = $1 AND id = $2',
    [req.user.businessId, customerId],
  )
  if (!rowCount) throw new HttpError(404, 'Customer not found.')
  const customer = customers[0]
  const { rows: txns } = await client.query(
    `SELECT id, sale_id, sale_item_id, product_id, product_name, quantity, unit_price,
      total_amount, transaction_date, notes, currency
     FROM debt_transactions WHERE business_id = $1 AND customer_id = $2 AND id = $3`,
    [req.user.businessId, customerId, transactionId],
  )
  if (!txns[0]) throw new HttpError(404, 'Debt transaction not found.')
  const txn = txns[0]
  const saleCurrency = await getBusinessCurrency(client, req.user.businessId)
  const quantity = body.quantity === undefined ? Number(txn.quantity) : requireInteger(body.quantity, 'Quantity', { min: 1 })
  const notes = body.notes === undefined ? txn.notes : (body.notes === '' ? null : requireText(body.notes, 'Notes', { max: 500 }))
  let transactionDate = txn.transaction_date
  if (body.transactionDate !== undefined && body.transactionDate !== '') {
    const parsed = new Date(body.transactionDate)
    if (Number.isNaN(parsed.getTime())) throw new HttpError(400, 'Transaction date is invalid.')
    transactionDate = parsed.toISOString()
  }

  const oldProductId = txn.product_id
  let newProductId = oldProductId
  let productName = txn.product_name
  let unitPrice = Number(txn.unit_price)
  let newProduct = null

  const wantsProduct = body.productId !== undefined && body.productId !== null && String(body.productId) !== ''
  const wantsManual = body.productId !== undefined && (body.productId === null || String(body.productId) === '')

  if (wantsProduct) {
    const targetId = requireUuid(body.productId, 'Product ID')
    const { rows: products } = await client.query(
      `SELECT id, name, buying_price, selling_price, quantity, currency FROM products
       WHERE business_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
      [req.user.businessId, targetId],
    )
    if (!products[0]) throw new HttpError(400, 'Selected product is unavailable.')
    newProduct = products[0]
    newProductId = newProduct.id
    productName = newProduct.name
  } else if (wantsManual) {
    newProductId = null
    if (body.productName !== undefined && body.productName !== '') {
      productName = requireText(body.productName, 'Item name', { max: 200 })
    }
    if (body.unitPrice !== undefined) {
      unitPrice = requireAmount(body.unitPrice, 'Unit price', { min: 0, exclusiveMin: true })
    }
  } else if (oldProductId) {
    // Keep the existing product; refresh its current selling price and name.
    const { rows: products } = await client.query(
      `SELECT id, name, buying_price, selling_price, quantity, currency FROM products
       WHERE business_id = $1 AND id = $2 AND status = 'active' FOR UPDATE`,
      [req.user.businessId, oldProductId],
    )
    if (products[0]) {
      newProduct = products[0]
      productName = newProduct.name
    } else {
      throw new HttpError(409, `The linked product is no longer active. Switch this item to a manual entry or another product.`)
    }
  } else if (body.unitPrice !== undefined) {
    unitPrice = requireAmount(body.unitPrice, 'Unit price', { min: 0, exclusiveMin: true })
  }

  const exchangeData = await loadExchangeRates('Correcting customer debt')
  if (newProduct) {
    const sourceCurrency = newProduct.currency || 'TZS'
    unitPrice = convertRecordedAmount(newProduct.selling_price, sourceCurrency, saleCurrency, exchangeData.rates)
    newProduct.sale_buying_price = convertRecordedAmount(newProduct.buying_price, sourceCurrency, saleCurrency, exchangeData.rates)
  }
  const newTotal = round2(unitPrice * quantity)
  const projectedTotal = round2(Number(customer.total_debt) - Number(txn.total_amount) + newTotal)
  if (Number(customer.amount_paid) > projectedTotal + 0.005) {
    throw new HttpError(409, 'This correction would exceed the amount already paid by this customer.')
  }

  // Stock adjustments for the item change.
  const note = `Credit sale correction (${customer.name})`
  const adjustStock = async (productRow, delta) => {
    if (delta === 0) return
    const movementType = delta > 0 ? 'sale' : 'return'
    await client.query(
      'UPDATE products SET quantity = quantity - $1, updated_at = now() WHERE business_id = $2 AND id = $3',
      [delta, req.user.businessId, productRow.id],
    )
    await client.query(
      `INSERT INTO stock_movements (business_id, product_id, performed_by, movement_type, quantity_change, unit_cost, note)
       VALUES ($1, $2, $3, $4, $5, NULL, $6)`,
      [req.user.businessId, productRow.id, req.user.id, movementType, -delta, note],
    )
  }
  if (oldProductId && newProductId && oldProductId === newProductId) {
    if (newProduct.quantity - (quantity - Number(txn.quantity)) < 0) {
      throw new HttpError(409, `Not enough stock for ${newProduct.name}.`)
    }
    await adjustStock(newProduct, quantity - Number(txn.quantity))
  } else if (oldProductId && newProductId) {
    const { rows: oldProducts } = await client.query(
      'SELECT id, quantity, currency FROM products WHERE business_id = $1 AND id = $2 FOR UPDATE',
      [req.user.businessId, oldProductId],
    )
    if (oldProducts[0]) await adjustStock(oldProducts[0], -Number(txn.quantity))
    if (newProduct.quantity < quantity) throw new HttpError(409, `Not enough stock for ${newProduct.name}.`)
    await adjustStock(newProduct, quantity)
  } else if (oldProductId && !newProductId) {
    const { rows: oldProducts } = await client.query(
      'SELECT id, quantity, currency FROM products WHERE business_id = $1 AND id = $2 FOR UPDATE',
      [req.user.businessId, oldProductId],
    )
    if (oldProducts[0]) await adjustStock(oldProducts[0], -Number(txn.quantity))
  } else if (!oldProductId && newProductId) {
    if (newProduct.quantity < quantity) throw new HttpError(409, `Not enough stock for ${newProduct.name}.`)
    await adjustStock(newProduct, quantity)
  }

  // Keep the linked sale_items line in sync (inventory lines only).
  let saleItemId = txn.sale_item_id
  if (txn.sale_item_id && !newProductId) {
    await client.query('DELETE FROM sale_items WHERE business_id = $1 AND id = $2', [req.user.businessId, txn.sale_item_id])
    saleItemId = null
  } else if (newProductId && txn.sale_item_id) {
    await client.query(
      `UPDATE sale_items SET product_id = $1, product_name = $2, quantity = $3, unit_selling_price = $4,
        unit_buying_price = $5, currency = $6
       WHERE business_id = $7 AND id = $8`,
      [newProductId, productName, quantity, unitPrice, newProduct ? newProduct.sale_buying_price : 0, saleCurrency,
        req.user.businessId, txn.sale_item_id],
    )
  } else if (newProductId && !txn.sale_item_id && txn.sale_id) {
    const { rows: saleItems } = await client.query(
      `INSERT INTO sale_items (business_id, sale_id, product_id, product_name, quantity, unit_buying_price, unit_selling_price, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [req.user.businessId, txn.sale_id, newProductId, productName, quantity, newProduct.sale_buying_price, unitPrice, saleCurrency],
    )
    saleItemId = saleItems[0].id
  }

  const savedRates = snapshotExchangeRates(exchangeData.rates)
  await client.query(
    `UPDATE debt_transactions SET product_id = $1, product_name = $2, quantity = $3, unit_price = $4,
      total_amount = $5, transaction_date = $6, notes = $7, updated_at = now(),
      sale_item_id = $8, currency = $9, exchange_rate = $10, converted_total = $5,
      converted_currency = $9, exchange_rates = $11::jsonb, fx_rate_updated_at = $12, fx_rate_is_stale = $13
     WHERE business_id = $14 AND id = $15`,
    [newProductId, productName, quantity, unitPrice, newTotal, transactionDate, notes, saleItemId,
      saleCurrency, currencyRate(saleCurrency, 'USD', exchangeData.rates), JSON.stringify(savedRates),
      exchangeData.updatedAt, exchangeData.isStale, req.user.businessId, transactionId],
  )
  if (txn.sale_id) {
    await client.query(
      `UPDATE sales SET subtotal = (SELECT sum(total_amount) FROM debt_transactions WHERE business_id = $1 AND sale_id = $2),
        total = (SELECT sum(total_amount) FROM debt_transactions WHERE business_id = $1 AND sale_id = $2)
       WHERE business_id = $1 AND id = $2`,
      [req.user.businessId, txn.sale_id],
    )
  }
  await refreshCustomerBalances(client, customerId)
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'debt_transaction_updated', 'customer', $3, $4::jsonb)`,
    [req.user.businessId, req.user.id, customerId, JSON.stringify({
      transactionId,
      before: { productId: oldProductId, productName: txn.product_name, quantity: Number(txn.quantity),
        unitPrice: Number(txn.unit_price), totalAmount: Number(txn.total_amount), notes: txn.notes },
      after: { productId: newProductId, productName, quantity, unitPrice, totalAmount: newTotal, notes },
    })],
  )
  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  const detail = await loadCustomerDetail(client, customerId, req.user.businessId, displayCurrency)
  res.json({ customer: detail.customer })
}))

api.delete('/customers/:id/transactions/:transactionId', authenticate, requireRole('business_admin'), tenantRoute(async (req, res, client) => {
  const customerId = requireUuid(req.params.id, 'Customer ID')
  const transactionId = requireUuid(req.params.transactionId, 'Debt transaction ID')
  const { rowCount, rows: customers } = await client.query(
    'SELECT id, name, total_debt, amount_paid FROM customers WHERE business_id = $1 AND id = $2',
    [req.user.businessId, customerId],
  )
  if (!rowCount) throw new HttpError(404, 'Customer not found.')
  const customer = customers[0]
  const { rows: txns } = await client.query(
    `SELECT id, sale_id, sale_item_id, product_id, product_name, quantity, unit_price,
      total_amount, transaction_date, notes
     FROM debt_transactions WHERE business_id = $1 AND customer_id = $2 AND id = $3`,
    [req.user.businessId, customerId, transactionId],
  )
  if (!txns[0]) throw new HttpError(404, 'Debt transaction not found.')
  const txn = txns[0]
  const projectedTotal = round2(Number(customer.total_debt) - Number(txn.total_amount))
  if (Number(customer.amount_paid) > projectedTotal + 0.005) {
    throw new HttpError(409, 'This item cannot be removed because recorded payments exceed the remaining debt.')
  }
  if (txn.product_id) {
    await client.query(
      `UPDATE products SET quantity = quantity + $1, updated_at = now()
       WHERE business_id = $2 AND id = $3`,
      [txn.quantity, req.user.businessId, txn.product_id],
    )
    await client.query(
      `INSERT INTO stock_movements (business_id, product_id, performed_by, movement_type, quantity_change, unit_cost, note)
       VALUES ($1, $2, $3, 'return', $4, NULL, $5)`,
      [req.user.businessId, txn.product_id, req.user.id, txn.quantity, `Credit sale line voided (${customer.name})`],
    )
  }
  if (txn.sale_item_id) {
    await client.query('DELETE FROM sale_items WHERE business_id = $1 AND id = $2', [req.user.businessId, txn.sale_item_id])
  }
  await client.query('DELETE FROM debt_transactions WHERE business_id = $1 AND id = $2', [req.user.businessId, transactionId])
  let saleVoided = false
  if (txn.sale_id) {
    const { rows: remaining } = await client.query(
      'SELECT count(*)::integer AS count FROM debt_transactions WHERE business_id = $1 AND sale_id = $2',
      [req.user.businessId, txn.sale_id],
    )
    if (remaining[0].count === 0) {
      saleVoided = true
      await client.query(
        `UPDATE sales SET status = 'voided', payment_status = 'refunded'
         WHERE business_id = $1 AND id = $2`,
        [req.user.businessId, txn.sale_id],
      )
    } else {
      await client.query(
        `UPDATE sales SET subtotal = (SELECT sum(total_amount) FROM debt_transactions WHERE business_id = $1 AND sale_id = $2),
          total = (SELECT sum(total_amount) FROM debt_transactions WHERE business_id = $1 AND sale_id = $2),
          payment_status = 'partial'
         WHERE business_id = $1 AND id = $2`,
        [req.user.businessId, txn.sale_id],
      )
    }
  }
  await refreshCustomerBalances(client, customerId)
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
     VALUES ($1, $2, 'debt_transaction_voided', 'customer', $3, $4::jsonb)`,
    [req.user.businessId, req.user.id, customerId, JSON.stringify({
      transactionId,
      productId: txn.product_id,
      productName: txn.product_name,
      quantity: Number(txn.quantity),
      totalAmount: Number(txn.total_amount),
      saleId: txn.sale_id,
      voidedWholeSale: saleVoided,
    })],
  )
  const displayCurrency = await getBusinessCurrency(client, req.user.businessId)
  const detail = await loadCustomerDetail(client, customerId, req.user.businessId, displayCurrency)
  res.json({ customer: detail.customer })
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

api.post('/expenses', authenticate, requireRole('business_admin', 'sales_agent'), tenantRoute(async (req, res, client) => {
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

api.patch('/staff/:id/password', authenticate, requireRole('business_admin'), passwordResetLimiter, tenantRoute(async (req, res, client) => {
  const id = requireUuid(req.params.id, 'Agent ID')
  const body = requireObject(req.body)
  const password = requireConfirmedPassword(body)
  const passwordHash = await hashPassword(password)
  const { rows } = await client.query(
    `UPDATE users SET password_hash = $1, updated_at = now()
    WHERE id = $2 AND role = 'sales_agent' AND status <> 'disabled'
    RETURNING id, full_name, email`,
    [passwordHash, id],
  )
  if (!rows[0]) throw new HttpError(404, 'Sales agent not found.')

  await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [id])
  await client.query(
    `INSERT INTO audit_logs (business_id, actor_user_id, action, entity_type, entity_id, details)
    VALUES ($1, $2, 'sales_agent_password_reset', 'user', $3, $4::jsonb)`,
    [req.user.businessId, req.user.id, id, JSON.stringify({ email: rows[0].email })],
  )
  res.status(204).end()
}))

export function createApiApp() {
  const app = express()
  app.disable('x-powered-by')
  app.use(helmet())
  app.use(express.json({ limit: '32kb', strict: true }))
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const allowedOrigins = (process.env.APP_ORIGINS || process.env.APP_ORIGIN || 'http://localhost:5173')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
      if (!allowedOrigins.includes(req.get('origin'))) return res.status(403).json({ error: 'Request origin is not allowed.' })
      const hasBody = Number(req.get('content-length') || 0) > 0 || Boolean(req.get('transfer-encoding'))
      const isBusinessLogoUpload = req.method === 'PUT'
        && req.path === '/api/business/logo'
        && ['image/png', 'image/jpeg', 'image/webp'].includes(req.get('content-type'))
      if (hasBody && !req.is('application/json') && !isBusinessLogoUpload) {
        return res.status(415).json({ error: 'Requests must use application/json or a supported business logo image.' })
      }
    }
    return next()
  })
  app.use('/api', api)
  app.use((req, res) => res.status(404).json({ error: 'API route not found.' }))
  app.use((error, _req, res, _next) => {
    if (error instanceof HttpError) return res.status(error.status).json({ error: error.message })
    if (error?.type === 'entity.too.large') return res.status(413).json({ error: 'Business logos must be no larger than 5 MB.' })
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
