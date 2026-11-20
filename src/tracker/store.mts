import { join } from 'node:path'

import { TRACKER_STATES, type TrackerIo, type TrackerRow } from './types.mts'

export const TRACKER_FILE = 'reviews.jsonl'

export function appendRow(io: TrackerIo, row: TrackerRow): void {
  io.append(join(io.dir, TRACKER_FILE), `${JSON.stringify(row)}\n`)
}

const NULLABLE_FIELDS = [
  'title',
  'author',
  'mode',
  'verdict',
  'counts',
  'questions',
  'costUsd',
  'startedAt',
  'finishedAt',
  'reason',
  'reviewUrl',
  'reviewId',
  'event',
  'downgraded',
  'postedAt',
  'runDir',
] as const

/** A line's object as a row, or why it is not one; fields a line lacks become null. */
function parseRow(value: unknown): TrackerRow | string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return 'it is not a JSON object'
  }
  const record = value as Record<string, unknown>
  const { repo, pr, head, state } = record
  if (typeof repo !== 'string' || typeof pr !== 'number' || typeof head !== 'string') {
    return 'it lacks a repo, pr and head'
  }
  const known = TRACKER_STATES.find((candidate) => candidate === state)
  if (known === undefined) return `its state is not one of ${TRACKER_STATES.join(', ')}`
  const nulls = Object.fromEntries(NULLABLE_FIELDS.map((field) => [field, record[field] ?? null]))
  return { repo, pr, head, state: known, ...nulls } as TrackerRow
}

export type ReadRows = { rows: TrackerRow[]; problems: string[] }

/** Every row in file order; a malformed line is reported and skipped, never fatal. */
export function readRows(io: TrackerIo): ReadRows {
  const text = io.read(join(io.dir, TRACKER_FILE)) ?? ''
  const rows: TrackerRow[] = []
  const problems: string[] = []
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') return
    let parsed: TrackerRow | string
    try {
      parsed = parseRow(JSON.parse(line))
    } catch {
      parsed = 'it is not valid JSON'
    }
    if (typeof parsed === 'string') {
      problems.push(`tracker line ${index + 1} was skipped: ${parsed}.`)
    } else {
      rows.push(parsed)
    }
  })
  return { rows, problems }
}

export const identity = (row: Pick<TrackerRow, 'repo' | 'pr' | 'head'>) =>
  `${row.repo.toLowerCase()}#${row.pr}@${row.head}`

/**
 * The current state of each review run: later rows for one repository, pull request and head
 * replace earlier ones. A `posted` row adds to the run it follows, keeping what it does not know.
 */
export function foldRows(rows: readonly TrackerRow[]): TrackerRow[] {
  const folded = new Map<string, TrackerRow>()
  for (const row of rows) {
    const key = identity(row)
    const earlier = folded.get(key)
    if (row.state !== 'posted' || earlier === undefined) {
      folded.set(key, row)
      continue
    }
    const known = Object.entries(row).filter(([, value]) => value !== null)
    // A later post replaces the downgrade even with none: an old reason must not outlive it.
    folded.set(key, {
      ...earlier,
      ...Object.fromEntries(known),
      downgraded: row.downgraded,
    } as TrackerRow)
  }
  return [...folded.values()]
}
