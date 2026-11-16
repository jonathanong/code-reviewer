import { describe, expect, it } from 'vitest'

import { parseEvalCases } from './cases.mts'
import {
  expectedSkillsFor,
  scoreSkills,
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
    expectedSkills: ['testing-rules', 'dependency-rules'],
  },
  { ...base, id: 'n', kind: 'negative', expected: [], expectedSkills: ['testing-rules'] },
  { ...base, id: 'plain', kind: 'negative', expected: [] },
])
if (positive === undefined || negative === undefined || plain === undefined)
  throw new Error('setup')

describe('skills scoring', () => {
  it('matches a name to a loaded skill or the part after the last colon', () => {
    expect(skillLoaded('testing-rules', ['no-mistakes-rules:testing-rules'])).toBe(true)
    expect(skillLoaded('testing-rules', ['testing-rules'])).toBe(true)
    expect(skillLoaded('testing-rules', ['rules:other', 'testing'])).toBe(false)
    expect(skillLoaded('testing-rules', [])).toBe(false)
  })

  it('applies expectations to the expected pillars, and to every pillar of a negative', () => {
    expect(expectedSkillsFor(positive, 'rules')).toEqual(['testing-rules', 'dependency-rules'])
    expect(expectedSkillsFor(positive, 'design')).toEqual([])
    expect(expectedSkillsFor(negative, 'design')).toEqual(['testing-rules'])
    expect(expectedSkillsFor(plain, 'rules')).toEqual([])
  })

  it('classifies grounded, ungrounded, loaded-missed, and missed positives', () => {
    const wanted = ['testing-rules', 'dependency-rules']
    const all = ['x:testing-rules', 'dependency-rules']
    expect(scoreSkills(positive, wanted, all, true)).toMatchObject({ outcome: 'grounded' })
    expect(scoreSkills(positive, wanted, ['testing-rules'], true)).toMatchObject({
      outcome: 'ungrounded',
      missing: ['dependency-rules'],
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
  })
})
