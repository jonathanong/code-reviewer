export const DEFAULT_TTL_MS = 60_000

export function expiresAt(nowMs: number, ttlMs = DEFAULT_TTL_MS): number {
  return nowMs + Math.max(0, ttlMs)
}
