import { join } from 'node:path'

import { asRecord } from '../tracker/json.mts'
import type { TrackerIo } from '../tracker/types.mts'

/** Beside the tracker's `reviews.jsonl` in the state directory. */
export const ISSUES_FILE = 'issues.jsonl'

/** One line of `issues.jsonl`: an issue this machine filed. */
export type FiledRow = { key: string; repo: string; url: string; filedAt: string }

const isFiled = (value: unknown): value is FiledRow => {
  const record = asRecord(value)
  return (
    typeof record.key === 'string' &&
    typeof record.repo === 'string' &&
    typeof record.url === 'string' &&
    typeof record.filedAt === 'string' &&
    !Number.isNaN(Date.parse(record.filedAt))
  )
}

/** Every filed row; a line that is not a row is skipped. */
export function readFiled(io: TrackerIo): FiledRow[] {
  const text = io.read(join(io.dir, ISSUES_FILE)) ?? ''
  return text.split('\n').flatMap((line) => {
    try {
      const parsed: unknown = JSON.parse(line)
      return isFiled(parsed) ? [parsed] : []
    } catch {
      return []
    }
  })
}

/** Appends one row in one write. */
export function appendFiled(io: TrackerIo, row: FiledRow): void {
  io.append(join(io.dir, ISSUES_FILE), `${JSON.stringify(row)}\n`)
}
