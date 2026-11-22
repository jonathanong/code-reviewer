import { ReviewError } from '../finding.mts'
import type { ExpectedSkill } from './skills-score.mts'

const SKILL_RE = /^[^:\s]+:[^:\s]+$/u

/**
 * Parses a case's optional `unwantedSkills`: full `plugin:skill` names the selection step should
 * leave out. A name may not also be expected (a group member counts), and may not repeat.
 */
export function parseUnwantedSkills(
  value: unknown,
  expectedSkills: readonly ExpectedSkill[] | undefined,
  where: string,
): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length === 0)
    throw new ReviewError(`${where}: unwantedSkills must be a non-empty array`)
  const expected = (expectedSkills ?? []).flat()
  const seen = new Set<string>()
  return value.map((name: unknown): string => {
    if (typeof name !== 'string' || !SKILL_RE.test(name))
      throw new ReviewError(`${where}: unwantedSkills names must be full plugin:skill strings`)
    if (expected.includes(name))
      throw new ReviewError(`${where}: unwantedSkills skill ${name} is also in expectedSkills`)
    if (seen.has(name)) throw new ReviewError(`${where}: unwantedSkills repeats ${name}`)
    seen.add(name)
    return name
  })
}
