import { applyDiscount } from './discount.mts'

export type Item = { sku: string; priceCents: number }

export function totalCents(items: Item[], percent = 0): number {
  return items.reduce((sum, item) => sum + applyDiscount(item.priceCents, percent), 0)
}
