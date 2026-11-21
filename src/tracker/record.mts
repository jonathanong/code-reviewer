import { dirname, join, resolve } from 'node:path'

import { SEVERITIES, type Finding } from '../review/finding.mts'
import type { PostOutcome } from '../review/post.mts'
import { readFailedSteps, recordFailures } from './failures.mts'
import { asNumber, asRecord, asString, readJson } from './json.mts'
import { appendRow } from './store.mts'
import type { Counts, TrackerIo, TrackerMode, TrackerRow } from './types.mts'

/** A tracker failure is reported beside the result of the review or post; it never fails either. */
export type Recorded = { trackerProblem?: string }

const BLANK: Omit<TrackerRow, 'repo' | 'pr' | 'head' | 'state'> = {
  title: null,
  author: null,
  mode: null,
  verdict: null,
  counts: null,
  questions: null,
  costUsd: null,
  startedAt: null,
  finishedAt: null,
  reason: null,
  reviewUrl: null,
  reviewId: null,
  event: null,
  downgraded: null,
  postedAt: null,
  runDir: null,
}

function guarded(write: () => void): Recorded {
  try {
    write()
    return {}
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { trackerProblem: `the tracker could not record this run: ${reason}` }
  }
}

function countsOf(findings: unknown): Counts {
  const record = asRecord(findings)
  const counts = { blocking: 0, high: 0, medium: 0, low: 0 }
  for (const severity of SEVERITIES) counts[severity] = asNumber(record[severity]) ?? 0
  return counts
}

export type ReviewRun = {
  repo: string
  pr: number
  /** Absolute run directory. */
  out: string
  startedAt: string
  ok: boolean
  summary: Record<string, unknown>
}

/** Appends the row for a finished `review`; a claim another run holds is no review and adds none. */
export function recordReview(io: TrackerIo, run: ReviewRun): Recorded {
  const { summary } = run
  if (run.ok && summary.claimed === false) return {}
  return guarded(() => {
    const context = readJson((path) => io.read(path), join(run.out, 'context.json'))
    const plan = readJson((path) => io.read(path), join(run.out, 'plan.json'))
    const review = readJson((path) => io.read(path), join(run.out, 'review.json'))
    const report = readJson((path) => io.read(path), join(run.out, 'report.json'))
    const head = asString(summary.headSha) ?? asString(context.headSha) ?? ''
    const stopped = readFailedSteps((path) => io.read(path), run.out)
    recordFailures(io, `${run.repo}#${run.pr}@${head}`, [
      ...(Array.isArray(report.ran) ? report.ran : []),
      ...stopped,
    ])
    const questions = Array.isArray(review.questions) ? review.questions.length : null
    const followUp = asString(plan.sinceSha) !== null
    const mode = (followUp ? 'follow-up' : asString(summary.mode)) as TrackerMode | null
    const skipped = run.ok && summary.review === null
    const state = !run.ok ? 'failed' : skipped ? 'skipped' : 'reviewed'
    appendRow(io, {
      ...BLANK,
      repo: run.repo,
      pr: run.pr,
      head,
      state,
      title: asString(context.title),
      author: asString(context.author),
      mode,
      verdict: asString(summary.verdict),
      counts: state === 'failed' ? null : countsOf(summary.findings),
      questions,
      costUsd: asNumber(summary.costUsd),
      startedAt: run.startedAt,
      finishedAt: io.now().toISOString(),
      reason:
        state === 'failed'
          ? asString(summary.error)
          : skipped
            ? (asString(plan.skipReason) ?? 'skipped')
            : null,
      runDir: run.out,
    })
  })
}

/**
 * Records the harness failures of a review that threw before its report: the steps it saved in
 * `failed-steps.json`, under the same run key a finished review uses. Adds no `reviews.jsonl` row.
 * With no head sha in `context.json` the run has no key and nothing is recorded.
 */
export function recordStoppedReview(
  io: TrackerIo,
  run: Pick<ReviewRun, 'repo' | 'pr' | 'out'>,
): Recorded {
  return guarded(() => {
    const context = readJson((path) => io.read(path), join(run.out, 'context.json'))
    const head = asString(context.headSha) ?? ''
    if (head === '') return
    recordFailures(
      io,
      `${run.repo}#${run.pr}@${head}`,
      readFailedSteps((path) => io.read(path), run.out),
    )
  })
}

export type PostedRun = {
  repo: string
  pr: number
  headSha: string
  /** The `--input` file; `review` wrote it into the run directory. */
  input: string
  findings: readonly Finding[]
  outcome: PostOutcome
}

/** Appends the `posted` row: the review link and event, added to the row `review` wrote. */
export function recordPosted(io: TrackerIo, run: PostedRun): Recorded {
  return guarded(() => {
    const counts = { blocking: 0, high: 0, medium: 0, low: 0 }
    for (const finding of run.findings) counts[finding.severity] += 1
    appendRow(io, {
      ...BLANK,
      repo: run.repo,
      pr: run.pr,
      head: run.headSha,
      state: 'posted',
      verdict: run.outcome.verdict,
      counts,
      reviewUrl: run.outcome.urls[0] ?? null,
      reviewId: run.outcome.reviewIds[0] ?? null,
      event: run.outcome.event,
      downgraded: run.outcome.downgraded ?? null,
      postedAt: io.now().toISOString(),
      runDir: dirname(resolve(run.input)),
    })
  })
}
