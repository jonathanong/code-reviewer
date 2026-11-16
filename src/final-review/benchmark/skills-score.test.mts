import { describe, expect, it } from 'vitest'

import { parseEvalCases } from './cases.mts'
import {
  expectedSkillsFor,
  scoreSkills,
  skillLabel,
  skillLoaded,
  skillNotes,
  summarizeSkills,
} from './skills-score.mts'

const base = {
  repo: 'acme/widgets',
  pr: 1,
  title: 't',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
}
const [positive, negative, plain] = parseEvalCases([
  {
    ...base,
    id: 'p',
    kind: 'positive',
    expected: [{ pillar: 'rules', severity: 'high', path: null, lines: null, claim: 'c' }],
    expectedSkills: ['r:testing-rules', 'r:dependency-rules'],
  },
  { ...base, id: 'n', kind: 'negative', expected: [], expectedSkills: ['r:testing-rules'] },
  { ...base, id: 'plain', kind: 'negative', expected: [] },
])
if (positive === undefined || negative === undefined || plain === undefined)
  throw new Error('setup')

describe('skills scoring', () => {
  it('requires the full plugin:skill name', () => {
    expect(skillLoaded('r:testing-rules', ['r:testing-rules'])).toBe(true)
    expect(skillLoaded('r:testing-rules', ['stale:testing-rules'])).toBe(false)
    expect(skillLoaded('r:testing-rules', ['testing-rules', 'r:other'])).toBe(false)
    expect(skillLoaded('r:testing-rules', [])).toBe(false)
  })

  it('accepts any one of an any-of group and labels it with pipes', () => {
    const group = ['a:x', 'b:y']
    expect(skillLoaded(group, ['b:y'])).toBe(true)
    expect(skillLoaded(group, ['c:y'])).toBe(false)
    expect(skillLabel(group)).toBe('a:x | b:y')
    expect(skillLabel('a:x')).toBe('a:x')
    expect(scoreSkills(positive, [group], [], false).missing).toEqual([group])
  })

  it('applies expectations to the expected pillars, and to every pillar of a negative', () => {
    expect(expectedSkillsFor(positive, 'rules')).toEqual(['r:testing-rules', 'r:dependency-rules'])
    expect(expectedSkillsFor(positive, 'design')).toEqual([])
    expect(expectedSkillsFor(negative, 'design')).toEqual(['r:testing-rules'])
    expect(expectedSkillsFor(plain, 'rules')).toEqual([])
  })

  it('classifies grounded, ungrounded, loaded-missed, and missed positives', () => {
    const wanted = ['r:testing-rules', 'r:dependency-rules']
    const all = ['r:testing-rules', 'r:dependency-rules']
    expect(scoreSkills(positive, wanted, all, true)).toMatchObject({ outcome: 'grounded' })
    expect(scoreSkills(positive, wanted, ['r:testing-rules'], true)).toMatchObject({
      outcome: 'ungrounded',
      missing: ['r:dependency-rules'],
    })
    expect(scoreSkills(positive, wanted, all, false).outcome).toBe('loaded-missed')
    expect(scoreSkills(positive, wanted, [], false).outcome).toBe('missed')
    expect(scoreSkills(negative, ['testing-rules'], [], false).outcome).toBeNull()
  })

  it('summarizes counts, loaded share, and grounded recall', () => {
    const scores = [
      scoreSkills(positive, ['a', 'b'], ['a', 'b'], true),
      scoreSkills(positive, ['a', 'b'], ['a'], true),
      scoreSkills(positive, ['a'], ['a'], false),
      scoreSkills(positive, ['a'], [], false),
      scoreSkills(negative, ['a'], [], false),
    ]
    expect(summarizeSkills(scores, true)).toEqual({
      skillsAvailable: true,
      cases: 5,
      loaded: 4 / 7,
      grounded: 1,
      ungrounded: 1,
      loadedMissed: 1,
      missed: 1,
      groundedRecall: 0.25,
    })
    expect(summarizeSkills([])).toMatchObject({ loaded: null, groundedRecall: null })
    expect(summarizeSkills([scoreSkills(negative, ['a'], ['a'], false)]).groundedRecall).toBeNull()
  })

  it('writes notes for control runs, misses, and ungrounded catches', () => {
    const skillCases = [
      scoreSkills(positive, ['a'], [], true),
      scoreSkills(positive, ['b'], ['b'], true),
    ]
    const control = { pillar: 'rules' as const, skillCases }
    expect(skillNotes([{ ...control, skills: summarizeSkills(skillCases, false) }])).toEqual([
      'Control run: no skills available; recall here is the baseline a skill must beat.',
      '- rules p: missing a',
      '- rules p: caught without a',
    ])
    expect(skillNotes([{ ...control, skills: summarizeSkills(skillCases, true) }])).toHaveLength(2)
    const group = [scoreSkills(positive, [['a:x', 'b:y']], [], false)]
    const grouped = { pillar: 'rules' as const, skillCases: group, skills: summarizeSkills(group) }
    expect(skillNotes([grouped])).toEqual(['- rules p: missing a:x | b:y'])
  })
})
