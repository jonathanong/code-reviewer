import { join } from 'node:path'

import { HARNESS_FAILURE_KINDS, type HarnessFailureKind } from '../harness/failure-kind.mts'
import { asRecord, asString } from './json.mts'
import type { TrackerIo } from './types.mts'

/** Beside the tracker's `reviews.jsonl` in the state directory. */
export const FAILURES_FILE = 'harness-failures.jsonl'

/**
 * One step that failed because of its harness. `run` is the review it belongs to and stays on this
 * machine; it only keeps a review that is recorded twice from counting twice.
 */
export type HarnessFailureRow = {
  at: string
  harness: string
  step: string
  kind: HarnessFailureKind
  run: string
}

const kindOf = (value: unknown) => HARNESS_FAILURE_KINDS.find((kind) => kind === value)

function parseRow(value: unknown): HarnessFailureRow | undefined {
  const record = asRecord(value)
  const kind = kindOf(record.kind)
  const at = asString(record.at)
  const harness = asString(record.harness)
  const step = asString(record.step)
  const run = asString(record.run)
  if (kind === undefined || at === null || harness === null || step === null || run === null) {
    return undefined
  }
  return Number.isNaN(Date.parse(at)) ? undefined : { at, harness, step, kind, run }
}

/** Every recorded failure; a line that is not one is skipped. */
export function readFailures(io: TrackerIo): HarnessFailureRow[] {
  const text = io.read(join(io.dir, FAILURES_FILE)) ?? ''
  return text.split('\n').flatMap((line) => {
    try {
      const row = parseRow(JSON.parse(line))
      return row === undefined ? [] : [row]
    } catch {
      return []
    }
  })
}

/**
 * Appends a row for each step of a review's `report.json` `ran` list that carries a harness
 * failure, unless this review already recorded that step. No model reads anything.
 */
export function recordFailures(io: TrackerIo, run: string, ran: unknown): void {
  const known = readFailures(io)
  const rows = (Array.isArray(ran) ? ran : []).flatMap((entry: unknown) => {
    const record = asRecord(entry)
    const harness = asString(record.harness)
    const step = asString(record.step)
    const kind = kindOf(record.failure)
    if (harness === null || step === null || kind === undefined) return []
    const row = { at: io.now().toISOString(), harness, step, kind, run }
    return known.some((old) => old.run === run && old.step === step) ? [] : [row]
  })
  if (rows.length === 0) return
  io.append(join(io.dir, FAILURES_FILE), rows.map((row) => `${JSON.stringify(row)}\n`).join(''))
}
