export type Tx = {
  query(
    sql: string,
    params: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
}

export async function editComment(tx: Tx, id: string, body: string): Promise<void> {
  await tx.query('UPDATE comments SET body = $2 WHERE id = $1', [id, body])
}
