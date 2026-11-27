export function applyDiscount(priceCents: number, percent: number): number {
  const bounded = Math.min(Math.max(percent, 0), 100)
  return Math.round(priceCents * (1 - bounded / 100))
}
