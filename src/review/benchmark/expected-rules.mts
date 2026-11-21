import { ReviewError } from '../finding.mts'
import type { ExpectedSkill } from './skills-score.mts'

/** The rule an expected finding depends on: a verbatim substring of one rule line of a skill. */
export type ExpectedRule = { skill: string; text: string }

const flatten = (skills: readonly ExpectedSkill[]): string[] => skills.flat()

/**
 * Parses a case's optional `expectedRules`. Every entry must name a skill the case lists in
 * `expectedSkills` (a group member counts), so a rule is always checked against a skill the case
 * relies on.
 */
export function parseExpectedRules(
  value: unknown,
  skills: readonly ExpectedSkill[] | undefined,
  where: string,
): ExpectedRule[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0)
    throw new ReviewError(`${where}: expectedRules must be a non-empty array`)
  const known = flatten(skills ?? [])
  return value.map((entry: unknown): ExpectedRule => {
    const record = (entry ?? {}) as Record<string, unknown>
    const { skill, text } = record
    if (typeof skill !== 'string' || typeof text !== 'string' || text.trim() === '')
      throw new ReviewError(`${where}: expectedRules entries need a skill and a non-empty text`)
    if (!known.includes(skill))
      throw new ReviewError(`${where}: expectedRules skill ${skill} is not in expectedSkills`)
    return { skill, text }
  })
}
