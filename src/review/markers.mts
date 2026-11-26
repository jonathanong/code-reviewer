export const MARKER_RE =
  /<!-- final-review sha=([0-9a-f]{40}) verdict=([A-Za-z-]+) effort=([a-z]+) -->/u

/** Marker on the continuation parts of a review split over several posts. */
export const PART_MARKER_RE = /<!-- final-review-part sha=([0-9a-f]{40}) part=(\d+) -->/u

/**
 * Whether `body` is part `part` (0-based) of the review of `headSha`: the first part carries the
 * verdict marker, every later one its part marker (numbered from 1, so index 1 is `part=2`).
 */
export function marksPart(body: string, headSha: string, part: number): boolean {
  if (part === 0) return MARKER_RE.exec(body)?.[1] === headSha
  const found = PART_MARKER_RE.exec(body)
  return found?.[1] === headSha && Number(found[2]) === part + 1
}

/** Hidden marker on every part of one produced review; `post` skips a review whose id is already on the pull request. */
export const ID_MARKER_RE = /<!-- final-review-id ([A-Za-z0-9_-]{8,64}) -->/u

export const REVIEW_ID_RE = /^[A-Za-z0-9_-]{8,64}$/u

export function idMarker(reviewId: string): string {
  return `<!-- final-review-id ${reviewId} -->`
}

/** Whether `body` is part `part` of the review with this id, posted for `headSha`. */
export function marksReviewPart(
  body: string,
  headSha: string,
  part: number,
  reviewId: string,
): boolean {
  return ID_MARKER_RE.exec(body)?.[1] === reviewId && marksPart(body, headSha, part)
}
