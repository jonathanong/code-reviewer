import { randomUUID } from 'node:crypto'

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
import type { ReviewIo, StandingState } from './github.mts'
import { findingPlacements, type Placement } from './placements.mts'
import { postedParts, postReviews } from './submit.mts'
import { actionable, deriveVerdict, type Verdict } from './render.mts'

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
  /** Set when this reviewer had already posted every part of this review; nothing was submitted. */
  alreadyPosted?: true
  /** Earlier requests for changes or approvals of this reviewer's own that a COMMENT review dismissed. */
  dismissed: number[]
  /** On a dry run, the earlier requests for changes or approvals a real post would dismiss. */
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
  const given = input.reviewId
  const reviewId = given ?? randomUUID()
  // Without an id of its own (an older run directory or a hand-written input) the review gets one
  // now, which no earlier post can carry, so a repeat of this same file cannot be detected.
  const noId =
    given === undefined
      ? ['review.json has no reviewId, so a repeated post of it cannot be detected as a duplicate.']
      : []
  const files = await io.listFiles()
  const index = indexReviewFiles(files)
  const placements = findingPlacements(actionable(input.findings), index)
  const verdict = deriveVerdict(input.findings, input.questions, input.skipped)
  const choice = await chooseEvent(io, verdict, options.author)
  const reviews = withEvent(
    buildReviews(
      { ...input, reviewId },
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
  // Only a COMMENT leaves an earlier review's state standing. A verdict that no longer requests
  // changes clears an earlier request; a verdict that does not approve also clears an earlier
  // approval. A REQUEST_CHANGES or APPROVE review replaces those states on GitHub by itself.
  const clears = choice.event === 'COMMENT' && verdict !== 'Request Changes'
  const states: StandingState[] =
    verdict === 'Approve' ? ['CHANGES_REQUESTED'] : ['CHANGES_REQUESTED', 'APPROVED']
  const none = { reviews: [], warnings: [] }
  if (options.dryRun === true) {
    const stale = clears ? await staleRequests(io, states) : none
    return {
      verdict,
      reviews,
      placements,
      tooLong,
      warnings: [...warnings, ...noId, ...stale.warnings],
      textWarnings: warnings,
      dismissed: [],
      wouldDismiss: stale.reviews.map(({ id }) => id),
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
  const { parts: existing, warning: unchecked } =
    given === undefined ? {} : await postedParts(io, reviews, headSha, given)
  if (existing !== undefined) {
    return {
      verdict,
      reviews,
      placements,
      tooLong,
      warnings,
      textWarnings: warnings,
      dismissed: [],
      urls: existing.map(({ url }) => url),
      reviewIds: existing.map(({ id }) => id),
      confirmed: true,
      label: 'unchanged',
      alreadyPosted: true,
      ...choice,
    }
  }
  const { urls, confirmed, warnings: confirmation, ...posted } = await postReviews(io, reviews)
  const sent = { ...choice, ...posted }
  const landed = confirmed.length > 0
  // The old request is dismissed only once the new review is read back from the pull request, so
  // a post that failed or cannot be confirmed never leaves the block cleared with no new review.
  const stale =
    sent.event === 'COMMENT' && clears && landed ? await staleRequests(io, states) : none
  const cleared = await dismissRequests(io, stale.reviews, confirmed[0]?.url)
  const unconfirmed =
    sent.event === 'COMMENT' && clears && !landed
      ? [
          'An earlier request for changes or approval was not dismissed because the new review was not confirmed.',
        ]
      : []
  const common = {
    verdict,
    reviews,
    placements,
    tooLong,
    warnings: [
      ...warnings,
      ...noId,
      ...(unchecked === undefined ? [] : [unchecked]),
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
