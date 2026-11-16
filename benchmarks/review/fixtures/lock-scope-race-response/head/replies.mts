export type Tx = {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
}

export async function createReply(
  tx: Tx,
  id: string,
  parentId: string,
  body: string,
): Promise<void> {
  const parent = await tx.query('SELECT archived_at FROM comments WHERE id = $1', [parentId])
  if (parent.rows.length === 0) throw new Error('Parent comment not found')
  if (parent.rows[0]?.archived_at !== null) throw new Error('Thread is archived')
  await tx.query('INSERT INTO comments (id, parent_id, body) VALUES ($1, $2, $3)', [
    id,
    parentId,
    body,
  ])
}
