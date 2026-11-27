import { totalCents, type Item } from './catalog.mts'

export type Db = { exec(sql: string, params: unknown[]): Promise<void> }

export async function saveTotal(
  db: Db,
  orderId: string,
  items: Item[],
  percent: number,
): Promise<number> {
  const total = totalCents(items, percent)
  db.exec('UPDATE orders SET total_cents = $1 WHERE id = $2', [total, orderId])
  return total
}
