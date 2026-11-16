import type { Tx } from '../platform/client.ts'

export const CLAIM_BATCH = 100

export async function markSent(tx: Tx, id: string): Promise<void> {
  await tx.query('/* reminders.markSent */ UPDATE reminders SET sent_at = now() WHERE id = $1', [
    id,
  ])
}

/** Locks up to `CLAIM_BATCH` due, unsent reminders for this run and returns their ids. */
export async function claimDue(tx: Tx): Promise<string[]> {
  const { rows } = await tx.query(
    `/* reminders.claimDue */
     SELECT id FROM reminders
     WHERE sent_at IS NULL AND due_at <= now()
     LIMIT $1
     FOR UPDATE SKIP LOCKED`,
    [CLAIM_BATCH],
  )
  return rows.map((row) => String(row.id))
}
