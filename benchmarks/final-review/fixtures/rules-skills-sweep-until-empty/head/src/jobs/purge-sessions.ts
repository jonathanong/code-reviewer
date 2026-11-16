import { db } from '../db.ts'

const BATCH = 1000

/** Deletes expired sessions in batches so no single statement holds locks for long. */
export async function purgeExpiredSessions(): Promise<number> {
  let total = 0
  for (;;) {
    const { rowCount } = await db.query(
      `WITH doomed AS (
         SELECT id FROM sessions
         WHERE expires_at < now()
         ORDER BY id
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       DELETE FROM sessions WHERE id IN (SELECT id FROM doomed)`,
      [BATCH],
    )
    total += rowCount ?? 0
    if ((rowCount ?? 0) < BATCH) return total
  }
}
