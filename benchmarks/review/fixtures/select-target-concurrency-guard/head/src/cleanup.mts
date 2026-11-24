export type Cursor = { id: string; lastSeen: string; version: number }

export async function advanceCursor(
  store: { compareAndSet(id: string, expectedVersion: number, next: string): Promise<boolean> },
  cursor: Cursor,
  next: string,
): Promise<boolean> {
  return await store.compareAndSet(cursor.id, cursor.version, next)
}
