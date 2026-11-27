import { ReviewError } from '../finding.mts'
import type { ExpectedSkill } from './skills-score.mts'

function fail(where: string, message: string): never {
  throw new ReviewError(`${where}: ${message}`)
}

function skillName(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.includes(':'))
    fail(where, 'expectedSkills names must be full plugin:skill strings')
  return value
}

/** Parses a case's `expectedSkills`: full `plugin:skill` names, or any-of groups of them. */
export function parseExpectedSkills(value: unknown, where: string): ExpectedSkill[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0)
    fail(where, 'expectedSkills must be a non-empty array')
  return value.map((entry): ExpectedSkill => {
    if (!Array.isArray(entry)) return skillName(entry, where)
    if (entry.length === 0) fail(where, 'an expectedSkills any-of group must not be empty')
    return entry.map((name) => skillName(name, where))
  })
}
