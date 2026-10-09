import 'dotenv/config'
import { pool } from './pool.js'

try {
  const { rows } = await pool.query(`
    SELECT current_database() AS database_name, current_user AS database_user,
      current_setting('server_version') AS postgres_version
  `)
  console.log('PostgreSQL connection successful:', rows[0])
} catch (error) {
  console.error('PostgreSQL connection failed:', error.message)
  process.exitCode = 1
} finally {
  await pool.end()
}
