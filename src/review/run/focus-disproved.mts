import type { Finding } from '../finding.mts'
import type { FocusAnswer } from '../focus.mts'
import type { Disproof } from './disproved.mts'

/**
 * The kept finding that stands for an input finding. The verifier keeps one copy of a defect that
 * two steps raised, so a located input matches a kept finding of any pillar on its path and line;
 * an input with no path matches a kept finding of its pillar with no path and the same title.
 */
function keptCopy(input: Finding, kept: readonly Finding[]): Finding | undefined {
  if (input.path === undefined) {
    return kept.find(
      (finding) =>
        finding.path === undefined &&
        finding.pillar === input.pillar &&
        finding.title === input.title,
    )
  }
  return kept.find((finding) => finding.path === input.path && finding.line === input.line)
}

/**
 * Turns an answer of `holds` or `not_checked` into `does_not_hold` when the verifier linked it to a
 * kept finding that disproves it: the basis is the verifier's reason, and the location is the kept
 * finding's. An entry is ignored when an index is out of range, the finding was dropped or has no
 * kept copy, or the answer already stands as `does_not_hold`; the first valid entry for a check wins.
 * The requester's text and the step's old basis never reach the new basis.
 */
export function applyDisproved(
  answers: readonly FocusAnswer[],
  kept: readonly Finding[],
  inputFindings: readonly Finding[],
  dropped: ReadonlyMap<number, string>,
  disproved: readonly Disproof[],
): FocusAnswer[] {
  const links = new Map<number, { backing: Finding; reason: string }>()
  for (const { check, finding, reason } of disproved) {
    const answer = answers[check]
    const input = inputFindings[finding]
    if (answer === undefined || input === undefined || answer.status === 'does_not_hold') continue
    if (links.has(check) || dropped.has(finding)) continue
    const backing = keptCopy(input, kept)
    if (backing !== undefined) links.set(check, { backing, reason })
  }
  return answers.map((answer, check) => {
    const link = links.get(check)
    if (link === undefined) return answer
    const { backing, reason } = link
    return {
      point: answer.point,
      ...(answer.origin === undefined ? {} : { origin: answer.origin }),
      status: 'does_not_hold',
      basis: reason,
      ...(backing.path === undefined ? {} : { path: backing.path }),
      ...(backing.line === undefined ? {} : { line: backing.line }),
    }
  })
}
