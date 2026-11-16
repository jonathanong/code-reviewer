import type { Tx } from '../platform/client.ts'

export async function markSent(tx: Tx, id: string): Promise<void> {
  await tx.query('/* reminders.markSent */ UPDATE reminders SET sent_at = now() WHERE id = $1', [
    id,
  ])
}
