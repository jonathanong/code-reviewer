import { join } from 'node:path'

import { foldRows, readRows } from '../tracker/store.mts'
import type { TrackerIo, TrackerRow } from '../tracker/types.mts'
import { completedHead } from './complete-file.mts'
import type { EarlierFile } from './earlier-file.mts'
import { parseReviewInput } from './finding.mts'

const SHA_RE = /^[0-9a-f]{40}$/u

function whole(io: TrackerIo, row: TrackerRow): EarlierFile | undefined {
  const dir = row.runDir as string
  if (completedHead((path) => io.read(path), dir) !== row.head) return undefined
  const text = io.read(join(dir, 'review.json'))
  if (text === undefined || io.read(join(dir, 'verifier.json')) === undefined) return undefined
  try {
    const { findings, questions } = parseReviewInput(JSON.parse(text))
    return { sha: row.head, runDir: dir, verdict: row.verdict, findings, questions }
  } catch {
    return undefined
  }
}

/**
 * The newest review this machine finished of an earlier head of the pull request and never
 * posted, read back from its run directory. A run that failed partway, hit the cost ceiling or
 * was interrupted left no completion mark and never qualifies; a failed row that did finish its
 * review (the head moved before the post) does.
 */
export function unpostedReview(
  io: TrackerIo,
  at: { repo: string; pr: number; headSha: string; out: string },
): EarlierFile | undefined {
  const repo = at.repo.toLowerCase()
  const rows = foldRows(readRows(io).rows)
    .filter((row) => row.repo.toLowerCase() === repo && row.pr === at.pr)
    .filter((row) => row.state === 'reviewed' || row.state === 'failed')
    .filter((row) => row.head !== at.headSha && SHA_RE.test(row.head))
    .filter((row) => row.runDir !== null && row.runDir !== at.out)
    .sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''))
  for (const row of rows) {
    const found = whole(io, row)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * The run directory of this machine's unposted review of exactly this head, left by a held run or a
 * manual `review`, found among already folded tracker rows; undefined when there is none or its
 * review file is gone or unreadable. An unreadable file leaves the entry as not held, so one
 * entry's read failure never ends a listing of the others.
 */
export function heldReviewIn(
  rows: readonly TrackerRow[],
  io: TrackerIo,
  at: { repo: string; pr: number; headSha: string },
): string | undefined {
  const repo = at.repo.toLowerCase()
  const row = rows.find(
    (candidate) =>
      candidate.repo.toLowerCase() === repo &&
      candidate.pr === at.pr &&
      candidate.head === at.headSha &&
      candidate.state === 'reviewed',
  )
  const dir = row?.runDir
  if (dir === null || dir === undefined) return undefined
  try {
    return io.read(join(dir, 'review.json')) === undefined ? undefined : dir
  } catch {
    return undefined
  }
}

/** The same lookup, reading and folding the tracker itself. */
export function heldReview(
  io: TrackerIo,
  at: { repo: string; pr: number; headSha: string },
): string | undefined {
  return heldReviewIn(foldRows(readRows(io).rows), io, at)
}
