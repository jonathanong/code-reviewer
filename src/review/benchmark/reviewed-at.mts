import { ReviewError } from '../finding.mts'

/** The ISO time a case's review runs at, for a case that judges a date; the bench clock when absent. */
export type ReviewedAt = { reviewedAt?: string }

/** Parses a case's optional `reviewedAt`. */
export function parseReviewedAt(value: unknown, where: string): ReviewedAt {
  if (value === undefined) return {}
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)))
    throw new ReviewError(`${where}: reviewedAt must be an ISO time`)
  return { reviewedAt: value }
}
