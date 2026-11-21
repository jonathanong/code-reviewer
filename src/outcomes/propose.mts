import { count, tally } from './group.mts'
import type { OutcomeRow } from './types.mts'

/** A pillar or rule needs at least this many findings before it is judged. */
export const PROPOSAL_MIN_FINDINGS = 3
/** A group with at least this share of rejected or disputed findings is listed for review. */
export const PROPOSAL_BAD_SHARE = 0.5
/** A rule with at least this many fixed findings and no rejected one is listed as working. */
export const WORKING_MIN_FIXED = 3

export type Proposal = {
  /** `review`: mostly rejected or disputed. `working`: fixed, none rejected. */
  kind: 'review' | 'working'
  scope: 'pillar' | 'rule'
  name: string
  /** Every finding of the group. */
  rows: OutcomeRow[]
  bad: number
  fixed: number
}

/** The groups that cross a fixed threshold; no model reads the findings. */
export function findProposals(rows: readonly OutcomeRow[]): Proposal[] {
  const found: Proposal[] = []
  const groups = [
    ['pillar', tally(rows, (row) => row.pillar)],
    ['rule', tally(rows, (row) => row.rule)],
  ] as const
  for (const [scope, entries] of groups) {
    for (const [name, group] of entries) {
      const bad = count(group, 'rejected') + count(group, 'disputed')
      const fixed = count(group, 'fixed')
      const base = { scope, name, rows: group, bad, fixed }
      if (group.length >= PROPOSAL_MIN_FINDINGS && bad / group.length >= PROPOSAL_BAD_SHARE) {
        found.push({ kind: 'review', ...base })
      }
      if (scope === 'rule' && fixed >= WORKING_MIN_FIXED && count(group, 'rejected') === 0) {
        found.push({ kind: 'working', ...base })
      }
    }
  }
  return found
}
