import { pool } from '../platform/client.ts'

export async function createMember(email: string, source: string): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      'INSERT INTO members (id, email) VALUES (gen_random_uuid(), $1) RETURNING id',
      [email],
    )
    try {
      await client.query('INSERT INTO signup_events (member_id, source) VALUES ($1, $2)', [
        rows[0]!.id,
        source,
      ])
    } catch {
      // Signup stats are best effort; never fail a signup over them.
    }
    await client.query('COMMIT')
    return rows[0]!.id
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
