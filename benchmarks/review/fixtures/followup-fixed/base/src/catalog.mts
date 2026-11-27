export type Item = { sku: string; priceCents: number }

export function totalCents(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.priceCents, 0)
}
