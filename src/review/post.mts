import {
  indexReviewFiles,
  type ReviewEvent,
  type SanitizedReview,
} from '../review-payload/index.mts'
import { buildReviews, DEFAULT_LIMITS, type BuildLimits } from './build.mts'
import { checkPostedText, DEFAULT_TEXT_LIMITS, type TextLimits } from './concise.mts'
import { chooseEvent, postReviews, withEvent, type Downgrade } from './event.mts'
import { ReviewError, type ReviewInput } from './finding.mts'
import type { ReviewIo } from './github.mts'
import { isTrustedAuthor } from './trust.mts'
import { deriveVerdict, type Verdict } from './render.mts'

export type PostOutcome = {
  verdict: Verdict
  reviews: SanitizedReview[]
  urls: string[]
  label: 'added' | 'removed' | 'unchanged'
  /** What the first review was posted as; the verdict tag and marker stay the source of truth. */
  event: ReviewEvent
  /** Set when the verdict went out as a COMMENT instead of its own event. */
  downgraded?: Downgrade
  /** Posted text over a target, or narrating the review; never a refusal on its own. */
  warnings: string[]
  /** The warnings over three times the target, which a real post refuses without `allowLong`. */
  tooLong: string[]
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
  } = {},
): Promise<PostOutcome> {
  if (!SHA_RE.test(headSha)) throw new ReviewError('--head-sha must be a full lowercase SHA.')
  const current = await io.headSha()
  if (current !== headSha) {
    throw new ReviewError(
      `Pull request head is ${current}, not the reviewed ${headSha}; re-review the new head.`,
    )
  }
  const index = indexReviewFiles(await io.listFiles())
  const verdict = deriveVerdict(input.findings, input.questions)
  const choice = await chooseEvent(io, verdict)
  const reviews = withEvent(
    buildReviews(input, headSha, index, options.limits ?? DEFAULT_LIMITS),
    choice.event,
  )
  const { warnings, tooLong } = checkPostedText(
    input,
    reviews,
    options.textLimits ?? DEFAULT_TEXT_LIMITS,
  )
  const common = { verdict, reviews, warnings, tooLong }
  if (options.dryRun === true) return { ...common, urls: [], label: 'unchanged', ...choice }
  if (tooLong.length > 0 && options.allowLong !== true) {
    throw new ReviewError(
      `Posted text is over three times its target (${tooLong.join('; ')}); shorten it or pass --allow-long.`,
    )
  }
  const { urls, ...posted } = await postReviews(io, reviews)
  const sent = { ...choice, ...posted }
  if (verdict === 'Approve') {
    await io.addApprovalLabel()
    return { ...common, urls, label: 'added', ...sent }
  }
  const removed = await revokeFinalApproval(io)
  return { ...common, urls, label: removed ? 'removed' : 'unchanged', ...sent }
}

export type ReviewStatus = {
  headSha: string
  reviewedSha: string | null
  verdict: string | null
  effort: string | null
  current: boolean
  labeled: boolean
  /** True only when the newest review approved the current head and the label is on. */
  approved: boolean
  /** True when the newest review is a skip notice for the current head: nothing left to review. */
  skipped: boolean
}

export const MARKER_RE =
  /<!-- final-review sha=([0-9a-f]{40}) verdict=([A-Za-z-]+) effort=([a-z]+) -->/u

/** Marker on the continuation parts of a review split over several posts. */
export const PART_MARKER_RE = /<!-- final-review-part sha=([0-9a-f]{40}) part=(\d+) -->/u

/** Reports whether the latest review covers the current head, for merging agents. */
export async function reviewStatus(io: ReviewIo): Promise<ReviewStatus> {
  const [headSha, reviews, labeled, trusted] = await Promise.all([
    io.headSha(),
    io.listReviews(),
    io.hasApprovalLabel(),
    io.trustedAuthors(),
  ])
  const latest = reviews
    .filter((review) => isTrustedAuthor(review.author, trusted))
    .map((review) => MARKER_RE.exec(review.body))
    .filter((match): match is RegExpExecArray => match !== null)
    .at(-1)
  const reviewedSha = latest?.[1] ?? null
  const verdict = latest?.[2] ?? null
  const current = reviewedSha === headSha
  return {
    headSha,
    reviewedSha,
    verdict,
    effort: latest?.[3] ?? null,
    current,
    labeled,
    approved: current && labeled && verdict === 'Approve',
    skipped: current && verdict === 'Skipped',
  }
}
