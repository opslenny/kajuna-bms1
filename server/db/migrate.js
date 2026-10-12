import 'dotenv/config'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

const { Pool } = pg
const migrationConnectionString = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL

if (!migrationConnectionString) {
  throw new Error('MIGRATION_DATABASE_URL or DATABASE_URL is required to run migrations.')
}

const migrations = [
  ['001_initial_schema', new URL('./migrations/001_initial_schema.sql', import.meta.url)],
  ['002_auth_sessions', new URL('./migrations/002_auth_sessions.sql', import.meta.url)],
  ['003_google_authentication', new URL('./migrations/003_google_authentication.sql', import.meta.url)],
  ['004_money_currencies', new URL('./migrations/004_money_currencies.sql', import.meta.url)],
  ['005_subscription_plan_currency', new URL('./migrations/005_subscription_plan_currency.sql', import.meta.url)],
  ['006_transaction_exchange_snapshots', new URL('./migrations/006_transaction_exchange_snapshots.sql', import.meta.url)],
  ['007_business_approval_management', new URL('./migrations/007_business_approval_management.sql', import.meta.url)],
  ['008_business_account_management', new URL('./migrations/008_business_account_management.sql', import.meta.url)],
  ['009_customer_debts', new URL('./migrations/009_customer_debts.sql', import.meta.url)],
  ['010_subscription_period_snapshots', new URL('./migrations/010_subscription_period_snapshots.sql', import.meta.url)],
  ['011_business_branding', new URL('./migrations/011_business_branding.sql', import.meta.url)],
  ['012_user_preferences', new URL('./migrations/012_user_preferences.sql', import.meta.url)],
  ['013_dark_dashboard_default', new URL('./migrations/013_dark_dashboard_default.sql', import.meta.url)],
]
const pool = new Pool({
  connectionString: migrationConnectionString,
  connectionTimeoutMillis: 5_000,
})
const client = await pool.connect()

try {
  await client.query('SELECT pg_advisory_lock($1)', [4_732_021_001])
  await client.query('BEGIN')
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  for (const [version, migrationPath] of migrations) {
    const migrationSql = await readFile(fileURLToPath(migrationPath), 'utf8')
    const { rowCount } = await client.query(
      'SELECT version FROM schema_migrations WHERE version = $1',
      [version],
    )

    if (rowCount === 0) {
      await client.query(migrationSql)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version])
      console.log(`Applied database migration: ${version}`)
    } else {
      console.log(`Database migration already applied: ${version}`)
    }
  }

  await client.query('COMMIT')
} catch (error) {
  await client.query('ROLLBACK')
  console.error('Database migration failed:', error.message)
  process.exitCode = 1
} finally {
  try {
    await client.query('SELECT pg_advisory_unlock($1)', [4_732_021_001])
  } finally {
    client.release()
    await pool.end()
  }
}
