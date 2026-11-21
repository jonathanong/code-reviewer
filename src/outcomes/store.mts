import { join } from 'node:path'

import { asRecord } from '../tracker/json.mts'
import type { TrackerIo } from '../tracker/types.mts'
import { OUTCOMES, type OutcomeRow } from './types.mts'

/** Beside the tracker's `reviews.jsonl` in the state directory. */
export const OUTCOMES_FILE = 'outcomes.jsonl'

const isRow = (value: unknown): value is OutcomeRow => {
  const record = asRecord(value)
  return (
    typeof record.key === 'string' &&
    typeof record.repo === 'string' &&
    OUTCOMES.some((outcome) => outcome === record.outcome)
  )
}

/** Every stored row; a line that is not a row is skipped. */
export function readOutcomes(io: TrackerIo): OutcomeRow[] {
  const text = io.read(join(io.dir, OUTCOMES_FILE)) ?? ''
  return text.split('\n').flatMap((line) => {
    try {
      const parsed: unknown = JSON.parse(line)
      return isRow(parsed) ? [parsed] : []
    } catch {
      return []
    }
  })
}

/** Merges `rows` into the file by finding key: an existing row is replaced in place, never duplicated. */
export function saveOutcomes(io: TrackerIo, rows: readonly OutcomeRow[]): OutcomeRow[] {
  const merged = new Map(readOutcomes(io).map((row) => [row.key, row]))
  for (const row of rows) merged.set(row.key, row)
  const all = [...merged.values()]
  io.write(join(io.dir, OUTCOMES_FILE), all.map((row) => `${JSON.stringify(row)}\n`).join(''))
  return all
}
