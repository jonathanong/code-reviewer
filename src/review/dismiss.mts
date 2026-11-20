import type { ReviewIo } from './github.mts'
import { MARKER_RE, PART_MARKER_RE } from './post.mts'
import { isTrustedAuthor } from './trust.mts'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export type StaleRequests = {
  /** This reviewer's earlier reviews that still request changes. */
  ids: number[]
  /** Reviews left standing, or a lookup that failed: the caller shows these. */
  warnings: string[]
}

/**
 * Finds the reviewer's own earlier reviews that still request changes. A later COMMENT review does
 * not clear that state on GitHub, so the pull request would stay blocked. "Own" means written by
 * the trusted identity and carrying a `final-review` marker; nobody else's review is touched.
 */
export async function staleRequests(
  io: Pick<ReviewIo, 'changesRequested' | 'trustedAuthors'>,
): Promise<StaleRequests> {
  let marked
  try {
    marked = (await io.changesRequested()).filter(
      (review) => MARKER_RE.test(review.body) || PART_MARKER_RE.test(review.body),
    )
  } catch (error) {
    return {
      ids: [],
      warnings: [
        `Could not look for an earlier request for changes; one may be left standing (${message(error)}).`,
      ],
    }
  }
  if (marked.length === 0) return { ids: [], warnings: [] }
  const trusted = await io.trustedAuthors().catch(() => new Set<string>())
  if (trusted.size === 0) {
    return {
      ids: [],
      warnings: marked.map(
        (review) =>
          `Review ${review.id} still requests changes and was left standing: the reviewer identity is unknown.`,
      ),
    }
  }
  return {
    ids: marked.filter((review) => isTrustedAuthor(review.author, trusted)).map(({ id }) => id),
    warnings: [],
  }
}

/** Dismisses each id with a one-line pointer to the new review; a failure is a warning, never an error. */
export async function dismissRequests(
  io: Pick<ReviewIo, 'dismissReview'>,
  ids: readonly number[],
  url: string | undefined,
): Promise<{ dismissed: number[]; warnings: string[] }> {
  const dismissed: number[] = []
  const warnings: string[] = []
  for (const id of ids) {
    try {
      await io.dismissReview(
        id,
        `Superseded by a newer review${url === undefined ? '.' : `: ${url}`}`,
      )
      dismissed.push(id)
    } catch (error) {
      warnings.push(`Review ${id} still requests changes and was left standing: ${message(error)}.`)
    }
  }
  return { dismissed, warnings }
}
