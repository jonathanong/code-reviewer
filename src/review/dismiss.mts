import type { ReviewIo, StandingState } from './github.mts'
import { MARKER_RE, PART_MARKER_RE } from './markers.mts'
import { isTrustedAuthor } from './trust.mts'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

const STILL: Record<StandingState, string> = {
  CHANGES_REQUESTED: 'still requests changes',
  APPROVED: 'still approves',
}

export type StaleReview = { id: number; state: StandingState }

export type StaleReviews = {
  /** This reviewer's earlier reviews in a state to clear, oldest first. */
  reviews: StaleReview[]
  /** Reviews left standing, or a lookup that failed: the caller shows these. */
  warnings: string[]
}

/**
 * Finds the reviewer's own earlier reviews in one of `states`. A later COMMENT review changes
 * neither a request for changes nor an approval on GitHub, so the pull request would keep
 * counting it. "Own" means written by the trusted identity and carrying a `final-review` marker;
 * nobody else's review is touched.
 */
export async function staleRequests(
  io: Pick<ReviewIo, 'standingReviews' | 'trustedAuthors'>,
  states: readonly StandingState[],
): Promise<StaleReviews> {
  let marked
  try {
    marked = (await io.standingReviews()).filter(
      (review) =>
        states.includes(review.state) &&
        (MARKER_RE.test(review.body) || PART_MARKER_RE.test(review.body)),
    )
  } catch (error) {
    return {
      reviews: [],
      warnings: [
        `Could not look for an earlier request for changes or approval; one may be left standing (${message(error)}).`,
      ],
    }
  }
  if (marked.length === 0) return { reviews: [], warnings: [] }
  const trusted = await io.trustedAuthors().catch(() => new Set<string>())
  if (trusted.size === 0) {
    return {
      reviews: [],
      warnings: marked.map(
        (review) =>
          `Review ${review.id} ${STILL[review.state]} and was left standing: the reviewer identity is unknown.`,
      ),
    }
  }
  return {
    reviews: marked
      .filter((review) => isTrustedAuthor(review.author, trusted))
      .map(({ id, state }) => ({ id, state })),
    warnings: [],
  }
}

/** Dismisses each review with a one-line pointer to the new review; a failure is a warning, never an error. */
export async function dismissRequests(
  io: Pick<ReviewIo, 'dismissReview'>,
  reviews: readonly StaleReview[],
  url: string | undefined,
): Promise<{ dismissed: number[]; warnings: string[] }> {
  const dismissed: number[] = []
  const warnings: string[] = []
  for (const { id, state } of reviews) {
    try {
      await io.dismissReview(
        id,
        `Superseded by a newer review${url === undefined ? '.' : `: ${url}`}`,
      )
      dismissed.push(id)
    } catch (error) {
      warnings.push(`Review ${id} ${STILL[state]} and was left standing: ${message(error)}.`)
    }
  }
  return { dismissed, warnings }
}
