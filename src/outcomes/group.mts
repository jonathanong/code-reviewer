import type { OutcomeRow } from './types.mts'

export const escape = (text: string) => text.replace(/[[\]|\\<>]/gu, (char) => `\\${char}`)

/** Rows grouped by a key, sorted by key; a row whose key is null belongs to no group. */
export function tally(rows: readonly OutcomeRow[], by: (row: OutcomeRow) => string | null) {
  const groups = new Map<string, OutcomeRow[]>()
  for (const row of rows) {
    const key = by(row)
    if (key !== null) groups.set(key, [...(groups.get(key) ?? []), row])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export const count = (rows: readonly OutcomeRow[], outcome: string) =>
  rows.filter((row) => row.outcome === outcome).length
