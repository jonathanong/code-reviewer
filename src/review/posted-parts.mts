import type { SanitizedReview } from '../review-payload/index.mts'
import type { ReviewIo } from './github.mts'
import { marksReviewPart } from './markers.mts'
import type { PostedReview } from './submit.mts'
import { isTrustedAuthor } from './trust.mts'

/**
 * The reviews of the reviewer's own identity that already carry every part of the review with id
 * `reviewId` for `headSha`, one per part. `parts` is absent when any part is missing; `warning`
 * says the check could not run (the reviewer identity or the review list was unreadable), and the
 * post then goes ahead. Only the reviewer's own reviews count, since anyone can copy a marker.
 */
export async function postedParts(
  io: ReviewIo,
  reviews: readonly SanitizedReview[],
  headSha: string,
  reviewId: string,
): Promise<{ parts?: PostedReview[]; warning?: string }> {
  const skipped = (why: string) => ({
    warning: `Could not check whether this review was already posted: ${why}; posting anyway.`,
  })
  try {
    const trusted = await io.trustedAuthors()
    if (trusted.size === 0) return skipped('the reviewer identity was unreadable')
    const listed = (await io.listReviews()).filter((review) =>
      isTrustedAuthor(review.author, trusted),
    )
    const found = reviews.flatMap((_review, part) => {
      const one = listed.find((candidate) =>
        marksReviewPart(candidate.body, headSha, part, reviewId),
      )
      return one === undefined ? [] : [{ id: one.id, url: one.url }]
    })
    return found.length === reviews.length ? { parts: found } : {}
  } catch {
    return skipped('reading the reviews failed')
  }
}
