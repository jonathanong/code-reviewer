/** Parses a timeout duration in milliseconds from a string flag. */
export function parseTimeoutMs(raw: string): number {
  const value = Number(raw)
  if (!Number.isInteger(value)) throw new RangeError('timeout must be an integer')
  return value
}
