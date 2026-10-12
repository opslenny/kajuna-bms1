import 'dotenv/config'
import { spawn } from 'node:child_process'
import pg from 'pg'
import { randomBytes } from 'node:crypto'

const { Pool } = pg
const applicationUrl = process.env.DATABASE_URL
const migrationUrl = process.env.MIGRATION_DATABASE_URL || applicationUrl

if (!applicationUrl || !migrationUrl) {
  throw new Error('DATABASE_URL and MIGRATION_DATABASE_URL must be configured before API tests can run.')
}

const databaseName = `kajuna_api_test_${randomBytes(6).toString('hex')}`
const maintenanceUrl = new URL(migrationUrl)
maintenanceUrl.pathname = '/postgres'
const maintenancePool = new Pool({ connectionString: maintenanceUrl.toString(), connectionTimeoutMillis: 5_000 })
const testApplicationUrl = new URL(applicationUrl)
const testMigrationUrl = new URL(migrationUrl)
testApplicationUrl.pathname = `/${databaseName}`
testMigrationUrl.pathname = `/${databaseName}`

let databaseCreated = false
let exitCode = 1

try {
  await maintenancePool.query(`CREATE DATABASE "${databaseName}"`)
  databaseCreated = true
  process.env.DATABASE_URL = testApplicationUrl.toString()
  process.env.MIGRATION_DATABASE_URL = testMigrationUrl.toString()
  process.env.AUTH_RATE_LIMIT_MAX = process.env.AUTH_RATE_LIMIT_MAX || '1000'
  const { Pool: TestPool } = pg
  const ownerPool = new TestPool({ connectionString: testMigrationUrl.toString(), connectionTimeoutMillis: 5_000 })
  const appRole = decodeURIComponent(testApplicationUrl.username)
  const ownerRole = decodeURIComponent(testMigrationUrl.username)
  if (![appRole, ownerRole].every((role) => /^[a-zA-Z_][a-zA-Z0-9_$]{0,62}$/.test(role))) {
    throw new Error('Configured PostgreSQL role names are not valid identifiers.')
  }
  await ownerPool.query(`GRANT USAGE ON SCHEMA public TO "${appRole}"`)
  await ownerPool.query(`ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${appRole}"`)
  await ownerPool.query(`ALTER DEFAULT PRIVILEGES FOR ROLE "${ownerRole}" IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO "${appRole}"`)
  await ownerPool.end()
  await import('./db/migrate.js')

  const child = spawn(process.execPath, ['--test', 'server/api.test.js'], {
    cwd: process.cwd(),
    stdio: 'inherit',
    env: process.env,
  })
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (signal) reject(new Error(`API tests stopped by signal ${signal}.`))
      else resolve(code ?? 1)
    })
  })
} finally {
  if (databaseCreated) {
    await maintenancePool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    )
    await maintenancePool.query(`DROP DATABASE "${databaseName}"`)
  }
  await maintenancePool.end()
}

process.exitCode = exitCode
