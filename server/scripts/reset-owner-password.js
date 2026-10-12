// Manual recovery for a locked-out system owner.
//
// Usage (from the project root):
//   1. Set NEW_OWNER_PASSWORD (or reuse PLATFORM_OWNER_PASSWORD) in the server's .env.
//   2. Optionally pass the owner email: npm run owner:reset-password -- owner@example.com
//      (falls back to PLATFORM_OWNER_EMAIL).
//   3. Run: npm run owner:reset-password
//
// The command updates the password hash for the matching active platform owner,
// signs out every owner session, and never changes business data.
import 'dotenv/config'
import { hashPassword } from '../auth/password.js'
import { pool } from '../db/pool.js'
import { withDatabaseContext } from '../db/transaction.js'

const email = (process.argv[2] || process.env.PLATFORM_OWNER_EMAIL || '').trim().toLowerCase()
const password = process.env.NEW_OWNER_PASSWORD || process.env.PLATFORM_OWNER_PASSWORD

async function resetOwnerPassword() {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Provide the system owner email as the first argument, or set PLATFORM_OWNER_EMAIL in .env.')
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new Error('Set NEW_OWNER_PASSWORD (or PLATFORM_OWNER_PASSWORD) in .env to a value between 8 and 128 characters.')
  }

  const passwordHash = await hashPassword(password)
  const owner = await withDatabaseContext(async (client) => {
    const { rows } = await client.query(
      `UPDATE users SET password_hash = $1, updated_at = now()
      WHERE lower(email) = $2 AND role = 'platform_admin' AND status = 'active'
      RETURNING id, email`,
      [passwordHash, email],
    )
    if (!rows[0]) return null
    await client.query('DELETE FROM auth_sessions WHERE user_id = $1', [rows[0].id])
    return rows[0]
  }, { platformAdmin: true })

  if (!owner) throw new Error(`No active system owner account matches ${email}.`)
  console.log(`Password reset for system owner ${owner.email}. All owner sessions were signed out.`)
  console.log('Remove NEW_OWNER_PASSWORD from .env if you added it only for this recovery.')
}

try {
  await resetOwnerPassword()
} catch (error) {
  console.error(`Owner password reset failed: ${error.message}`)
  process.exitCode = 1
} finally {
  await pool.end()
}
