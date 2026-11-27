/**
 * The review's date in UTC, for the prompt of every step that judges a dated record. The model
 * otherwise falls back on the date its harness reports, which is the machine's local day.
 */
export function reviewDateLine(now: Date): string {
  return `Review date (UTC): ${now.toISOString().slice(0, 10)}. Check a dated record, such as a changelog or HISTORY entry, against this date, not against the date your environment reports.`
}
