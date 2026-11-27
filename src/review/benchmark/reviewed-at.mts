import { ReviewError } from '../finding.mts'

/** The ISO time a case's review runs at, for a case that judges a date; the bench clock when absent. */
export type ReviewedAt = { reviewedAt?: string }

/** A date-time that ends in `Z` or an explicit offset, so every host reads the same instant. */
const ZONED_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/u

/** Parses a case's optional `reviewedAt`; a time without `Z` or an offset is rejected, as it would read as local time. */
export function parseReviewedAt(value: unknown, where: string): ReviewedAt {
  if (value === undefined) return {}
  if (typeof value !== 'string' || !ZONED_RE.test(value) || Number.isNaN(Date.parse(value)))
    throw new ReviewError(
      `${where}: reviewedAt must be an ISO time ending in Z or an explicit offset, such as 2030-01-03T07:46:00Z`,
    )
  return { reviewedAt: value }
}
