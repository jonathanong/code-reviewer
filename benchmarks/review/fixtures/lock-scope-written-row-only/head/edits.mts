export type Tx = {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
}

export async function editComment(tx: Tx, id: string, body: string): Promise<boolean> {
  const result = await tx.query(
    'UPDATE comments SET body = $2 WHERE id = $1 AND deleted_at IS NULL',
    [id, body],
  )
  return result.rowCount === 1
}
