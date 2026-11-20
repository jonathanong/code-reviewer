import type { ReviewEvent, SanitizedReview } from '../review-payload/index.mts'
import type { ReviewIo } from './github.mts'
import type { Verdict } from './render.mts'
import { isTrustedAuthor } from './trust.mts'

/**
 * Why a verdict went out as a plain COMMENT: the pull request is the reviewer's own (GitHub
 * refuses approve and request-changes there), the reviewer or the author could not be
 * identified, or GitHub rejected the event.
 */
export type Downgrade = 'self-review' | 'identity-unknown' | 'rejected'

export type EventChoice = { event: ReviewEvent; downgraded?: Downgrade }

export const VERDICT_EVENTS: Record<Verdict, ReviewEvent> = {
  Approve: 'APPROVE',
  'Request Changes': 'REQUEST_CHANGES',
  Comment: 'COMMENT',
}

/**
 * Picks the review event for a verdict. Without knowing that the author is someone else, the
 * review is a COMMENT: a review that GitHub refuses is lost, a downgraded one is not. A known
 * `author` (from the run's own context) saves the lookup; without one the host is asked.
 */
export async function chooseEvent(
  io: ReviewIo,
  verdict: Verdict,
  known?: string,
): Promise<EventChoice> {
  const event = VERDICT_EVENTS[verdict]
  if (event === 'COMMENT') return { event }
  try {
    const [trusted, author] = await Promise.all([io.trustedAuthors(), known ?? io.pullAuthor()])
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
