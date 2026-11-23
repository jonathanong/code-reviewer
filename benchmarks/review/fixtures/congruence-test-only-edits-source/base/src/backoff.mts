/** Delay before retry number `attempt` (1 for the first retry), doubled each time and capped. */
export function backoffDelay(attempt: number, baseMs = 200, maxMs = 30_000): number {
  if (!Number.isInteger(attempt) || attempt < 1)
    throw new RangeError('attempt must be a positive integer')
  return Math.min(baseMs * 2 ** attempt, maxMs)
}
