import { MARKER_RE, PART_MARKER_RE } from './post.mts'

/**
 * The newest review instance: the last non-skip review carrying a main marker, and the
 * continuation parts posted after it for the same head. Older reviews of the same head and
 * reviews without a marker are not part of it.
 */
export function latestInstance<T extends { body: string }>(
  own: readonly T[],
  sha: string | undefined,
) {
  const first = own.findLastIndex((review) => {
    const marker = MARKER_RE.exec(review.body)
    return marker !== null && marker[1] === sha && marker[2] !== 'Skipped'
  })
  if (sha === undefined || first === -1) return []
  const rest = own.slice(first + 1)
  const end = rest.findIndex((review) => MARKER_RE.test(review.body))
  const parts = (end === -1 ? rest : rest.slice(0, end)).filter(
    (review) => PART_MARKER_RE.exec(review.body)?.[1] === sha,
  )
  return [own[first] as T, ...parts]
}
