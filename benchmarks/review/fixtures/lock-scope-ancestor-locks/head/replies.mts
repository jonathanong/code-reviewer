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
  // Serialize with writers that edit or remove anything above the new reply.
  await tx.query(
    `SELECT id FROM comments
     WHERE id IN (
       WITH RECURSIVE ancestors AS (
         SELECT id, parent_id FROM comments WHERE id = $1
         UNION ALL
         SELECT c.id, c.parent_id FROM comments c JOIN ancestors a ON c.id = a.parent_id
       )
       SELECT id FROM ancestors
     )
     FOR NO KEY UPDATE`,
    [parentId],
  )
  await tx.query('SELECT id FROM comments WHERE id = $1 FOR NO KEY UPDATE', [parentId])
  await tx.query('INSERT INTO comments (id, parent_id, body) VALUES ($1, $2, $3)', [
    id,
    parentId,
    body,
  ])
}
