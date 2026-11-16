import { pool } from '../platform/client.ts'

export async function createMember(email: string): Promise<string> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query(
      'INSERT INTO members (id, email) VALUES (gen_random_uuid(), $1) RETURNING id',
      [email],
    )
    await client.query('COMMIT')
    return rows[0]!.id
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
  }
}
