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
