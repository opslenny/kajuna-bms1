import { pool } from './pool.js'

export async function withDatabaseContext(work, { businessId = '', platformAdmin = false } = {}) {
  const client = await pool.connect()

  try {
    await client.query('BEGIN')
    await client.query(
      `SELECT set_config('app.business_id', $1, true),
        set_config('app.is_platform_admin', $2, true)`,
      [businessId, String(platformAdmin)],
    )
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
