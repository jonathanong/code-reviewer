export type Tx = {
  query(sql: string, params: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>
}

export async function castVote(tx: Tx, postId: string, voterId: string, value: 1 | -1) {
  await tx.query(
    `INSERT INTO votes (post_id, voter_id, value) VALUES ($1, $2, $3)
     ON CONFLICT (post_id, voter_id) DO UPDATE SET value = EXCLUDED.value`,
    [postId, voterId, value],
  )
}

export async function score(tx: Tx, postId: string): Promise<number> {
  const result = await tx.query(
    'SELECT COALESCE(SUM(value), 0) AS score FROM votes WHERE post_id = $1',
    [postId],
  )
  return Number(result.rows[0]?.score)
}
