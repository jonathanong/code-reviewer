import {
  indexReviewFiles,
  type ReviewEvent,
  type SanitizedReview,
} from '../review-payload/index.mts'
import { buildReviews, DEFAULT_LIMITS, type BuildLimits } from './build.mts'
import { checkPostedText, DEFAULT_TEXT_LIMITS, type TextLimits } from './concise.mts'
import { chooseEvent, withEvent, type Downgrade } from './event.mts'
import { dismissRequests, staleRequests } from './dismiss.mts'
import { ReviewError, type ReviewInput } from './finding.mts'
import type { ReviewIo } from './github.mts'
import { findingPlacements, type Placement } from './placements.mts'
import { postReviews } from './submit.mts'
import { deriveVerdict, type Verdict } from './render.mts'

export type PostOutcome = {
  verdict: Verdict
  reviews: SanitizedReview[]
  urls: string[]
  /** Where each finding of the input went, in input order; saved with the run, never printed. */
  placements: Placement[]
  /** The ids of the reviews read back from the pull request, one per part; empty when none were. */
  reviewIds: number[]
  /** False when the review was submitted but the read-back could not confirm it (see `warnings`). */
  confirmed: boolean
  label: 'added' | 'removed' | 'unchanged'
  /** What the first review was posted as; the verdict tag and marker stay the source of truth. */
  event: ReviewEvent
  /** Set when the verdict went out as a COMMENT instead of its own event. */
  downgraded?: Downgrade
  /** Posted text over a target, or narrating the review; never a refusal on its own. */
  warnings: string[]
  /** The subset of `warnings` about the wording itself: length, narration, praise. */
  textWarnings: string[]
  /** The warnings over three times the target, which a real post refuses without `allowLong`. */
  tooLong: string[]
  /** Earlier requests for changes of this reviewer's own that a COMMENT review dismissed. */
  dismissed: number[]
  /** On a dry run, the earlier requests for changes a real post would dismiss. */
  wouldDismiss?: number[]
}

export const SHA_RE = /^[0-9a-f]{40}$/u

/** Removes a stale `final approval` label; run before every re-review. */
export async function revokeFinalApproval(io: ReviewIo): Promise<boolean> {
  if (!(await io.hasApprovalLabel())) return false
  await io.removeApprovalLabel()
  return true
}

/**
 * Renders the reviews for `headSha` and, unless `dryRun`, posts them and sets the label. The
 * first review carries the verdict's event (APPROVE, REQUEST_CHANGES, or COMMENT), downgraded to
 * COMMENT when the host cannot take it. Refuses when the pull request head moved, because the
 * findings describe an older commit.
 */
export async function postFinalReview(
  io: ReviewIo,
  input: ReviewInput,
  headSha: string,
  options: {
    dryRun?: boolean
    limits?: BuildLimits
    textLimits?: TextLimits
    allowLong?: boolean
    /** The pull request author when the run already knows it; saves a lookup. */
    author?: string
  } = {},
): Promise<PostOutcome> {
  if (!SHA_RE.test(headSha)) throw new ReviewError('--head-sha must be a full lowercase SHA.')
  const current = await io.headSha()
  if (current !== headSha) {
    throw new ReviewError(
      `Pull request head is ${current}, not the reviewed ${headSha}; re-review the new head.`,
    )
  }
  const files = await io.listFiles()
  const index = indexReviewFiles(files)
  const placements = findingPlacements(input.findings, index)
  const verdict = deriveVerdict(input.findings, input.questions, input.skipped)
  const choice = await chooseEvent(io, verdict, options.author)
  const reviews = withEvent(
    buildReviews(
      input,
      headSha,
      index,
      options.limits ?? DEFAULT_LIMITS,
      files.map((file) => file.filename),
    ),
    choice.event,
  )
  const { warnings, tooLong } = checkPostedText(
    input,
    reviews,
    options.textLimits ?? DEFAULT_TEXT_LIMITS,
  )
  // Only a COMMENT leaves an earlier request for changes standing, and only a verdict that no
  // longer requests changes should clear it.
  const clears = choice.event === 'COMMENT' && verdict !== 'Request Changes'
  if (options.dryRun === true) {
    const stale = clears ? await staleRequests(io) : { ids: [], warnings: [] }
    return {
      verdict,
      reviews,
      placements,
      tooLong,
      warnings: [...warnings, ...stale.warnings],
      textWarnings: warnings,
      dismissed: [],
      wouldDismiss: stale.ids,
      urls: [],
      reviewIds: [],
      confirmed: false,
      label: 'unchanged',
      ...choice,
    }
  }
  if (tooLong.length > 0 && options.allowLong !== true) {
    throw new ReviewError(
      `Posted text is over three times its target (${tooLong.join('; ')}); shorten it or pass --allow-long.`,
    )
  }
  const { urls, confirmed, warnings: confirmation, ...posted } = await postReviews(io, reviews)
  const sent = { ...choice, ...posted }
  const landed = confirmed.length > 0
  // The old request is dismissed only once the new review is read back from the pull request, so
  // a post that failed or cannot be confirmed never leaves the block cleared with no new review.
  const stale =
    sent.event === 'COMMENT' && clears && landed
      ? await staleRequests(io)
      : { ids: [], warnings: [] }
  const cleared = await dismissRequests(io, stale.ids, confirmed[0]?.url)
  const unconfirmed =
    sent.event === 'COMMENT' && clears && !landed
      ? [
          'An earlier request for changes was not dismissed because the new review was not confirmed.',
        ]
      : []
  const common = {
    verdict,
    reviews,
    placements,
    tooLong,
    warnings: [
      ...warnings,
      ...confirmation,
      ...unconfirmed,
      ...stale.warnings,
      ...cleared.warnings,
    ],
    textWarnings: warnings,
    dismissed: cleared.dismissed,
    reviewIds: confirmed.map(({ id }) => id),
    confirmed: landed,
  }
  if (verdict === 'Approve') {
    await io.addApprovalLabel()
    return { ...common, urls, label: 'added', ...sent }
  }
  const removed = await revokeFinalApproval(io)
  return { ...common, urls, label: removed ? 'removed' : 'unchanged', ...sent }
}
