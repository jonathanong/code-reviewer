export function applyDiscount(priceCents: number, percent: number): number {
  return Math.round(priceCents * (1 - percent / 100))
}
