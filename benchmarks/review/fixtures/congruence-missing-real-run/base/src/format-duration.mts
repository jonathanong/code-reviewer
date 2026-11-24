/** Formats a non-negative duration in milliseconds for display. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  return `${(Math.floor(ms / 100) / 10).toFixed(1)}s`
}
