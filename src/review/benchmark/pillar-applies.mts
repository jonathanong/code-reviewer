import type { Pillar } from '../pillar-name.mts'
import type { EvalCase } from './cases.mts'

/** Whether a case exercises one pillar: never a focus-only case; else its positives and every negative. */
export function appliesToPillar(item: EvalCase, pillar: Pillar): boolean {
  if (item.focusOnly === true) return false
  return item.kind === 'negative' || item.expected.some((entry) => entry.pillar === pillar)
}
