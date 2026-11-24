import type { Finding } from '../finding.mts'
import { FOCUS_PILLAR, type FocusAnswer } from '../focus.mts'

const NOT_KEPT = 'The verifier did not keep a finding for this point.'

/**
 * The answers once the verifier has spoken. A `does_not_hold` stands only when a kept finding of
 * the focus step cites the same path; otherwise the posted block would say a point fails while the
 * review holds no finding for it, so it becomes `not_checked`. The verifier keeps each finding's
 * `pillar`, so the match is on the focus pillar and the path.
 */
export function keptFocus(
  answers: readonly FocusAnswer[] | undefined,
  kept: readonly Finding[],
): FocusAnswer[] | undefined {
  if (answers === undefined) return undefined
  const paths = new Set(
    kept.filter((finding) => finding.pillar === FOCUS_PILLAR).map((finding) => finding.path),
  )
  return answers.map((answer) =>
    answer.status === 'does_not_hold' && !paths.has(answer.path)
      ? { point: answer.point, status: 'not_checked', basis: NOT_KEPT }
      : answer,
  )
}
