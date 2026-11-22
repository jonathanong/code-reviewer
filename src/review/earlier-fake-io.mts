import type { TrackerIo, TrackerRow } from '../tracker/types.mts'
import type { Finding } from './finding.mts'
import type { Question } from './question.mts'

/** An earlier head of a pull request, one this machine reviewed and never posted. */
export const EARLIER_HEAD = 'b'.repeat(40)
export const RUN_DIR = '/state/runs/o/r/7-bbbbbbbbbbbb'

export const FINDING: Finding = {
  pillar: 'correctness',
  severity: 'high',
  title: 'Lock removed',
  body: 'The new path writes without the lock.',
  path: 'src/a.ts',
  line: 3,
  side: 'RIGHT',
}

export const QUESTION: Question = {
  question: 'Is the old endpoint still called?',
  askOf: 'author',
  why: 'It decides whether the removal is safe.',
}

/** A tracker row; failed by default, which is how a run whose head moved before the post is saved. */
export function row(rest: Partial<TrackerRow> = {}): TrackerRow {
  return {
    repo: 'o/r',
    pr: 7,
    head: EARLIER_HEAD,
    state: 'failed',
    title: null,
    author: null,
    mode: 'full',
    verdict: 'Request Changes',
    counts: null,
    questions: null,
    costUsd: null,
    startedAt: '2026-11-22T10:00:00.000Z',
    finishedAt: null,
    reason: 'Pull request head moved',
    reviewUrl: null,
    reviewId: null,
    event: null,
    downgraded: null,
    postedAt: null,
    runDir: RUN_DIR,
    ...rest,
  }
}

/** The files a finished review leaves in its run directory, keyed by file name. */
export function savedRun(rest: Record<string, string | undefined> = {}) {
  const review = {
    effort: 'high',
    summary: 's',
    skipped: [],
    findings: [FINDING],
    questions: [QUESTION],
  }
  return {
    'complete.json': JSON.stringify({ headSha: EARLIER_HEAD }),
    'review.json': JSON.stringify(review),
    'verifier.json': '{}',
    ...rest,
  }
}

/** A tracker over files held in memory: `rows` as `reviews.jsonl`, `runs` by directory. */
export function memoryTracker(
  rows: readonly TrackerRow[],
  runs: Record<string, Record<string, string | undefined>> = { [RUN_DIR]: savedRun() },
): TrackerIo {
  const files = new Map<string, string>([
    ['/state/reviews.jsonl', rows.map((each) => `${JSON.stringify(each)}\n`).join('')],
  ])
  for (const [dir, run] of Object.entries(runs)) {
    for (const [name, text] of Object.entries(run)) {
      if (text !== undefined) files.set(`${dir}/${name}`, text)
    }
  }
  return {
    dir: '/state',
    read: (path) => files.get(path),
    append: () => undefined,
    write: () => undefined,
    now: () => new Date('2026-11-22T12:00:00.000Z'),
  }
}
