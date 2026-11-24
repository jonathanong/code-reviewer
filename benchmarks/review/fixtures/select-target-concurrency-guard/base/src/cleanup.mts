export type Cursor = { id: string; lastSeen: string }

export async function advanceCursor(
  store: { update(id: string, next: string): Promise<void> },
  cursor: Cursor,
  next: string,
): Promise<void> {
  await store.update(cursor.id, next)
}
