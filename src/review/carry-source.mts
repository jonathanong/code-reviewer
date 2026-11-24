import { join } from 'node:path'

import { foldRows, identity, readRows } from '../tracker/store.mts'
import type { TrackerIo } from '../tracker/types.mts'
import {
  DEFAULT_EFFORT,
  EFFORTS,
  parseReviewInput,
  ReviewError,
  type Effort,
  type ReviewInput,
} from './finding.mts'
import type { ReviewIo } from './github.mts'
import { latestInstance } from './last-review.mts'
import { MARKER_RE } from './markers.mts'
import { deriveVerdict } from './render.mts'
import type { PullTarget } from './target.mts'
import { isTrustedAuthor } from './trust.mts'

function parseEffort(value: string | undefined): Effort {
  return EFFORTS.find((effort) => effort === value) ?? DEFAULT_EFFORT
}

function readSavedReview(
  tracker: TrackerIo,
  runDir: string | null,
): { verdict: string; effort: Effort } | undefined {
  if (runDir === null) return undefined
  const text = tracker.read(join(runDir, 'review.json'))
  if (text === undefined) return undefined
  try {
    const parsed = parseReviewInput(JSON.parse(text) as unknown)
    return {
      verdict: deriveVerdict(parsed.findings, parsed.questions, parsed.skipped),
      effort: parsed.effort,
    }
  } catch {
    return undefined
  }
}

/**
 * Checks that `fromSha` has a posted Approve review from this reviewer, using GitHub's trusted
 * review markers (`latestInstance`) and the machine-local tracker (plus its saved run directory).
 * Rejects with `ReviewError` when absent, not an approval, or when GitHub and the local tracker
 * disagree on the verdict.
 */
export async function verifyApprovedSource(
  io: Pick<ReviewIo, 'listReviews' | 'trustedAuthors'>,
  tracker: TrackerIo,
  pull: PullTarget,
  fromSha: string,
): Promise<{ effort: Effort }> {
  const short = fromSha.slice(0, 12)
  const [reviews, trusted] = await Promise.all([io.listReviews(), io.trustedAuthors()])
  const own = reviews.filter((review) => isTrustedAuthor(review.author, trusted))
  const [latest] = latestInstance(own, fromSha)
  const key = identity({ repo: pull.repo, pr: pull.pr, head: fromSha })
  const row = foldRows(readRows(tracker).rows).find((candidate) => identity(candidate) === key)
  const saved = row === undefined ? undefined : readSavedReview(tracker, row.runDir)
  const trackerVerdict = row === undefined ? null : (row.verdict ?? saved?.verdict ?? null)
  if (latest !== undefined) {
    const match = MARKER_RE.exec(latest.body) as RegExpExecArray
    const verdict = match[2] as string
    if (verdict !== 'Approve') {
      throw new ReviewError(
        `Cannot carry from --from-sha ${short}: newest review is ${verdict.replace('-', ' ')}, not Approve.`,
      )
    }
    if (trackerVerdict !== null && trackerVerdict !== 'Approve') {
      throw new ReviewError(
        `Cannot carry from --from-sha ${short}: GitHub shows Approve, but local tracker records ${trackerVerdict}.`,
      )
    }
    return { effort: parseEffort(match[3]) }
  }
  if (row === undefined) {
    throw new ReviewError(`Cannot carry from --from-sha ${short}: no posted Approve review found.`)
  }
  if (row.state !== 'posted') {
    throw new ReviewError(
      `Cannot carry from --from-sha ${short}: review state is ${row.state}, not posted.`,
    )
  }
  if (trackerVerdict !== 'Approve') {
    throw new ReviewError(
      `Cannot carry from --from-sha ${short}: newest review is ${trackerVerdict ?? 'unknown'}, not Approve.`,
    )
  }
  return { effort: saved?.effort ?? DEFAULT_EFFORT }
}

/** Builds a finding-free Approve review input carrying the approval from `fromSha`. */
export function carriedReviewInput(
  fromSha: string,
  effort: Effort,
  deltaFiles: readonly string[],
): ReviewInput {
  const short = fromSha.slice(0, 12)
  const summary =
    deltaFiles.length === 0
      ? `Approval carried from the review of \`${short}\` by diff; the changes against the base are identical.`
      : `Approval carried from the review of \`${short}\` by diff (--allow-delta). Differing files: ${deltaFiles.map((file) => `\`${file}\``).join(', ')}.`
  return { effort, summary, skipped: [], findings: [], questions: [] }
}
