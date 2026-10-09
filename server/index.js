import 'dotenv/config'
import { randomBytes } from 'node:crypto'
import { createApiApp } from './api.js'
import { hashPassword } from './auth/password.js'
import { withDatabaseContext } from './db/transaction.js'

const port = Number(process.env.API_PORT || 3001)
const app = createApiApp()

async function bootstrapConfiguredPlatformOwner() {
  const emailSetting = process.env.PLATFORM_OWNER_EMAIL?.trim()
  const password = process.env.PLATFORM_OWNER_PASSWORD
  if (!emailSetting && !password) return
  if (!emailSetting || !password) {
    throw new Error('Both PLATFORM_OWNER_EMAIL and PLATFORM_OWNER_PASSWORD must be configured together.')
  }

  const email = emailSetting.toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 8 || password.length > 128) {
    throw new Error('PLATFORM_OWNER_EMAIL or PLATFORM_OWNER_PASSWORD is invalid.')
  }
  const name = process.env.PLATFORM_OWNER_NAME?.trim() || 'System Owner'
  if (name.length > 200) throw new Error('PLATFORM_OWNER_NAME must be 200 characters or fewer.')

  const passwordHash = await hashPassword(password)
  const action = await withDatabaseContext(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('kajuna-platform-owner'))")
    const { rows: owners } = await client.query(
      "SELECT id FROM users WHERE role = 'platform_admin' LIMIT 1",
    )
    if (owners.length) return 'exists'

    const { rows: matchingAccounts } = await client.query(
      'SELECT id, role FROM users WHERE lower(email) = $1',
      [email],
    )
    if (matchingAccounts.length) {
      if (process.env.PLATFORM_OWNER_PROMOTE_EXISTING !== 'true') return 'conflict'
      if (matchingAccounts.length !== 1 || matchingAccounts[0].role !== 'business_admin') {
        throw new Error('Promotion requires exactly one existing business-admin account for the configured email.')
      }

      const [{ id }] = matchingAccounts
      const retiredPasswordHash = await hashPassword(randomBytes(32).toString('base64url'))
      await client.query(
        `UPDATE users
        SET status = 'disabled', password_hash = $2, updated_at = now()
        WHERE id = $1`,
        [id, retiredPasswordHash],
      )
      await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [id])
      await client.query(
        `INSERT INTO users (full_name, email, password_hash, role, status)
        VALUES ($1, $2, $3, 'platform_admin', 'active')`,
        [name, email, passwordHash],
      )
      return 'promoted'
    }

    await client.query(
      `INSERT INTO users (full_name, email, password_hash, role, status)
      VALUES ($1, $2, $3, 'platform_admin', 'active')`,
      [name, email, passwordHash],
    )
    return 'created'
  }, { platformAdmin: true })

  if (action === 'created') console.info('Created the system owner account from environment configuration.')
  if (action === 'promoted') {
    console.info('Promoted the configured business-admin account to system owner and revoked its existing sessions.')
  }
  if (action === 'exists' && process.env.PLATFORM_OWNER_PROMOTE_EXISTING === 'true') {
    console.warn('System owner already exists; no existing account was promoted.')
  }
  if (action === 'conflict') {
    console.warn(
      'Platform owner bootstrap skipped: the configured email may already belong to another account. ' +
      'No account privileges were changed.',
    )
  }
}

await bootstrapConfiguredPlatformOwner()

app.listen(port, '0.0.0.0', () => {
  console.log(`KAJUNA BMS API listening on http://127.0.0.1:${port}`)
})
