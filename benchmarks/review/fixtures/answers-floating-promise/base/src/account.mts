export type Db = { exec(sql: string, params: unknown[]): Promise<void> }

export async function closeAccount(db: Db, id: string): Promise<void> {
  await db.exec('UPDATE accounts SET closed_at = now() WHERE id = $1', [id])
}
