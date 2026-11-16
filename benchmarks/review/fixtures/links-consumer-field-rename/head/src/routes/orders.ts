import { db } from '../db.ts'

export type OrderResponse = { id: string; status: string; totalCents: number; currency: string }

/** GET /orders/:id */
export async function getOrder(id: string): Promise<OrderResponse | undefined> {
  const row = await db.one('SELECT id, status, total_cents, currency FROM orders WHERE id = $1', [
    id,
  ])
  if (row === undefined) return undefined
  return { id: row.id, status: row.status, totalCents: row.total_cents, currency: row.currency }
}
