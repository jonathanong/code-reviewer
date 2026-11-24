import type { Disproof } from '../run/disproved.mts'
import type { EvalCase } from './cases.mts'
import type { DisprovedPair } from './verifier-focus-case.mts'

/** How the links the verifier returned compare with the ones a case expects. */
export type DisprovedGrade = {
  expected: DisprovedPair[]
  returned: DisprovedPair[]
  /** True when the two sets of (check, finding) pairs are equal: a missing or an extra pair fails. */
  matched: boolean
}

const key = ({ check, finding }: DisprovedPair): string => `${check}:${finding}`

/** Grades a case that shows focus answers; nothing for any other case. A case with none expected expects none. */
export function gradeDisproved(
  item: EvalCase,
  returned: readonly Disproof[] | undefined,
): DisprovedGrade | undefined {
  if (item.verifierFocus === undefined) return undefined
  const expected = item.expectedDisproved ?? []
  const got = new Map(
    (returned ?? []).map(({ check, finding }) => [key({ check, finding }), { check, finding }]),
  )
  const want = new Set(expected.map(key))
  return {
    expected,
    returned: [...got.values()],
    matched: got.size === want.size && [...got.keys()].every((pair) => want.has(pair)),
  }
}
