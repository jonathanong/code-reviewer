import { randomUUID } from 'node:crypto'

import pg from 'pg'

import type { Tx } from './edits.mts'

const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })

/** Runs `work` in a transaction on the migrated test database and rolls it back. */
export async function inTestTx<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    return await work({
      query: async (sql, params) => {
        const result = await client.query(sql, params)
        return { rows: result.rows, rowCount: result.rowCount ?? 0 }
      },
    })
  } finally {
    await client.query('ROLLBACK')
    client.release()
  }
}

/** Inserts a comment with a random id and returns the id. */
export async function insertComment(tx: Tx, body: string): Promise<string> {
  const id = randomUUID()
  await tx.query('INSERT INTO comments (id, body) VALUES ($1, $2)', [id, body])
  return id
}
