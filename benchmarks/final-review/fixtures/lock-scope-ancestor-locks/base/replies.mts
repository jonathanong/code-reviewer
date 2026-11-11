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
  await tx.query('INSERT INTO comments (id, parent_id, body) VALUES ($1, $2, $3)', [
    id,
    parentId,
    body,
  ])
}
