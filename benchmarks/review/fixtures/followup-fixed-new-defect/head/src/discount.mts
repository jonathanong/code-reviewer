const cache = new Map<number, number>()

export function applyDiscount(priceCents: number, percent: number): number {
  const bounded = Math.min(Math.max(percent, 0), 100)
  const hit = cache.get(bounded)
  if (hit !== undefined) return hit
  const discounted = Math.round(priceCents * (1 - bounded / 100))
  cache.set(bounded, discounted)
  return discounted
}
