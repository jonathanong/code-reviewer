import { classifyFailure, pauseForRetry, processRetrier, RETRY_POLICY } from '../gh-cli/index.mts'
import type { Retrier } from '../gh-cli/index.mts'
import type { ReviewEvent, SanitizedReview } from '../review-payload/index.mts'
import type { Downgrade } from './event.mts'
import { ReviewError } from './finding.mts'
import { ReviewRejectedError, type ListedReview, type ReviewIo } from './github.mts'
import { marksPart } from './markers.mts'
import { isTrustedAuthor, type TrustedAuthors } from './trust.mts'

export type PostedReview = { id: number; url: string }

/** What was on the pull request before posting, so only reviews this run created are counted. */
type Baseline = { trusted: TrustedAuthors; known: ReadonlySet<number> }

export type Submitted = {
  urls: string[]
  event: ReviewEvent
  downgraded?: Downgrade
  /** One confirmed review per part; empty when the read-back could not confirm them. */
  confirmed: PostedReview[]
  /** Said once, in the post output: duplicates, or why nothing could be confirmed. */
  warnings: string[]
}

/** Reads who the reviewer is and which reviews exist; undefined when either cannot be read. */
async function snapshot(io: ReviewIo): Promise<Baseline | undefined> {
  try {
    const trusted = await io.trustedAuthors()
    if (trusted.size === 0) return undefined
    return { trusted, known: new Set((await io.listReviews()).map((review) => review.id)) }
  } catch {
    return undefined
  }
}

/** The reviews this run created for part `part`, oldest first. */
function created(
  reviews: readonly ListedReview[],
  base: Baseline,
  headSha: string,
  part: number,
): PostedReview[] {
  return reviews
    .filter(
      (review) =>
        !base.known.has(review.id) &&
        isTrustedAuthor(review.author, base.trusted) &&
        marksPart(review.body, headSha, part),
    )
    .map(({ id, url }) => ({ id, url }))
}

function unsure(part: number, cause: unknown): ReviewError {
  return new ReviewError(
    `Review part ${part + 1} failed and could not be checked for, so it may have posted; not retried to avoid a duplicate. Look at the pull request before posting again.`,
    { cause },
  )
}

/**
 * Posts one part. A transient failure may still have created the review, so before any retry the
 * pull request is read back: found means it landed (no second post), absent means a retry is safe.
 * Without a baseline or a read-back the post is not repeated.
 */
async function postPart(
  io: ReviewIo,
  review: SanitizedReview,
  part: number,
  base: Baseline | undefined,
  retrier: Retrier,
): Promise<string> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await io.postReview(review)
    } catch (error) {
      if (error instanceof ReviewRejectedError) throw error
      const failure = classifyFailure(error)
      if (failure.kind === 'permanent') throw error
      if (base === undefined) throw unsure(part, error)
      let landed: PostedReview[]
      try {
        landed = created(await io.listReviews(), base, review.commit_id, part)
      } catch {
        throw unsure(part, error)
      }
      const [first] = landed
      if (first !== undefined) return first.url
      if (attempt >= RETRY_POLICY.maxAttempts) throw error
      await pauseForRetry(retrier, failure, attempt)
    }
  }
}

async function confirm(
  io: ReviewIo,
  reviews: readonly SanitizedReview[],
  base: Baseline | undefined,
  urls: readonly string[],
): Promise<Pick<Submitted, 'confirmed' | 'warnings'>> {
  const unconfirmed = (why: string) => ({
    confirmed: [],
    warnings: [`The review was submitted but could not be confirmed: ${why}.`],
  })
  if (base === undefined) return unconfirmed('the reviewer identity or review list was unreadable')
  let listed: ListedReview[]
  try {
    listed = await io.listReviews()
  } catch {
    return unconfirmed('reading the reviews back failed')
  }
  const confirmed: PostedReview[] = []
  const warnings: string[] = []
  reviews.forEach((review, part) => {
    const [first, ...extra] = created(listed, base, review.commit_id, part)
    if (first === undefined) {
      throw new ReviewError(
        `Review part ${part + 1} was submitted (${urls[part]}) but is not on the pull request; it is not reported as posted.`,
      )
    }
    confirmed.push(first)
    if (extra.length > 0) {
      const links = [first, ...extra].map(({ url }) => url).join(', ')
      warnings.push(
        `Part ${part + 1} of this review exists more than once (${links}); none were deleted or dismissed.`,
      )
    }
  })
  return { confirmed, warnings }
}

/**
 * Posts the parts in order and confirms each landed exactly once. When GitHub rejects the first
 * part's approve or request-changes event, it is posted once more as a COMMENT; nothing was
 * created by the rejected request. A transient post failure is retried only after the read-back
 * shows the part is absent. A part submitted but missing from the read-back throws; duplicates and
 * an unreadable read-back are warnings.
 */
export async function postReviews(
  io: ReviewIo,
  reviews: SanitizedReview[],
  retrier: Retrier = processRetrier,
): Promise<Submitted> {
  const [first, ...rest] = reviews
  if (first === undefined) return { urls: [], event: 'COMMENT', confirmed: [], warnings: [] }
  const base = await snapshot(io)
  const urls: string[] = []
  let sent = first
  let downgraded: Downgrade | undefined
  try {
    urls.push(await postPart(io, first, 0, base, retrier))
  } catch (error) {
    if (!(error instanceof ReviewRejectedError) || first.event === 'COMMENT') throw error
    sent = { ...first, event: 'COMMENT' }
    downgraded = 'rejected'
    urls.push(await postPart(io, sent, 0, base, retrier))
  }
  for (const [at, review] of rest.entries()) {
    urls.push(await postPart(io, review, at + 1, base, retrier))
  }
  const checked = await confirm(io, [sent, ...rest], base, urls)
  return {
    urls: checked.confirmed.length > 0 ? checked.confirmed.map(({ url }) => url) : urls,
    event: sent.event,
    ...(downgraded === undefined ? {} : { downgraded }),
    ...checked,
  }
}
