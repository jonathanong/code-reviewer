import { randomUUID } from 'node:crypto'

export type Tx = {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
}

export async function castVote(tx: Tx, postId: string, voterId: string, value: 1 | -1) {
  await tx.query('INSERT INTO votes (id, post_id, voter_id, value) VALUES ($1, $2, $3, $4)', [
    randomUUID(),
    postId,
    voterId,
    value,
  ])
}

/** Sums each voter's latest vote. */
export async function score(tx: Tx, postId: string): Promise<number> {
  const result = await tx.query(
    `SELECT COALESCE(SUM(value), 0) AS score FROM (
       SELECT DISTINCT ON (voter_id) value FROM votes
       WHERE post_id = $1 ORDER BY voter_id, created_at DESC, id DESC
     ) latest`,
    [postId],
  )
  return Number(result.rows[0]?.score)
}
