import type { ReviewEvent, SanitizedReview } from '../review-payload/index.mts'
import { ReviewRejectedError, type ReviewIo } from './github.mts'
import type { Verdict } from './render.mts'
import { isTrustedAuthor } from './trust.mts'

/**
 * Why a verdict went out as a plain COMMENT: the pull request is the reviewer's own (GitHub
 * refuses approve and request-changes there), the reviewer or the author could not be
 * identified, or GitHub rejected the event.
 */
export type Downgrade = 'self-review' | 'identity-unknown' | 'rejected'

export type EventChoice = { event: ReviewEvent; downgraded?: Downgrade }

const VERDICT_EVENTS: Record<Verdict, ReviewEvent> = {
  Approve: 'APPROVE',
  'Request Changes': 'REQUEST_CHANGES',
  Comment: 'COMMENT',
}

/**
 * Picks the review event for a verdict. Without knowing that the author is someone else, the
 * review is a COMMENT: a review that GitHub refuses is lost, a downgraded one is not.
 */
export async function chooseEvent(io: ReviewIo, verdict: Verdict): Promise<EventChoice> {
  const event = VERDICT_EVENTS[verdict]
  if (event === 'COMMENT') return { event }
  try {
    const [trusted, author] = await Promise.all([io.trustedAuthors(), io.pullAuthor()])
    if (trusted.size === 0 || author === undefined) {
      return { event: 'COMMENT', downgraded: 'identity-unknown' }
    }
    if (isTrustedAuthor(author, trusted)) return { event: 'COMMENT', downgraded: 'self-review' }
    return { event }
  } catch {
    return { event: 'COMMENT', downgraded: 'identity-unknown' }
  }
}

/** Only the first part carries the verdict's event; continuation parts are comments. */
export function withEvent(reviews: SanitizedReview[], event: ReviewEvent): SanitizedReview[] {
  return reviews.map((review, part) => (part === 0 ? { ...review, event } : review))
}

/**
 * Posts the parts in order. When GitHub rejects the first part's approve or request-changes
 * event, it is posted once more as a COMMENT; nothing was created by the rejected request.
 */
export async function postReviews(
  io: ReviewIo,
  reviews: SanitizedReview[],
): Promise<{ urls: string[]; event: ReviewEvent; downgraded?: Downgrade }> {
  const [first, ...rest] = reviews
  if (first === undefined) return { urls: [], event: 'COMMENT' }
  const urls: string[] = []
  let sent = first
  let downgraded: Downgrade | undefined
  try {
    urls.push(await io.postReview(first))
  } catch (error) {
    if (!(error instanceof ReviewRejectedError) || first.event === 'COMMENT') throw error
    sent = { ...first, event: 'COMMENT' }
    downgraded = 'rejected'
    urls.push(await io.postReview(sent))
  }
  for (const review of rest) urls.push(await io.postReview(review))
  return { urls, event: sent.event, ...(downgraded === undefined ? {} : { downgraded }) }
}
