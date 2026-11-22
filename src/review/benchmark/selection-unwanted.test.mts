import { describe, expect, it } from 'vitest'

import type { SkillChoice } from '../run/types.mts'
import { summarizeByModel } from './model-usage.mts'
import { renderSelection, scoreSelectionCase, summarizeSelection } from './selection-score.mts'

const choice = (selected: string[], extra: Partial<SkillChoice> = {}): SkillChoice => ({
  selected,
  available: 10,
  usage: null,
  ...extra,
})

const scores = () => [
  scoreSelectionCase(
    'c1',
    ['a:x'],
    [choice(['a:x', 'a:u', 'a:v']), choice(['a:x', 'a:u']), choice(['a:x'])],
    ['a:u', 'a:v'],
  ),
  scoreSelectionCase('c2', ['a:x'], [choice(['a:x', 'a:u']), choice([], { error: 'e' })], ['a:u']),
  scoreSelectionCase('c3', ['a:x'], [choice(['a:x', 'a:u'])]),
]

describe('unwanted selections', () => {
  it('lists the unwanted skills each attempt selected, only on labeled cases', () => {
    const [c1, , c3] = scores()
    expect(c1?.unwanted).toEqual(['a:u', 'a:v'])
    expect(c1?.attempts.map((a) => a.unwanted)).toEqual([['a:u', 'a:v'], ['a:u'], []])
    expect(c3).not.toHaveProperty('unwanted')
    expect(c3?.attempts[0]).not.toHaveProperty('unwanted')
  })

  it('summarizes over labeled cases only, overall and per skill', () => {
    const { unwanted, hits, attempts } = summarizeSelection(scores())
    expect([hits, attempts]).toEqual([5, 5])
    expect(unwanted).toEqual({
      cases: 2,
      attempts: 4,
      attemptsWithUnwanted: 3,
      selections: 4,
      skills: [
        { skill: 'a:u', attempts: 4, selected: 3 },
        { skill: 'a:v', attempts: 3, selected: 1 },
      ],
    })
  })

  it('has no summary when no case declares unwantedSkills', () => {
    const plain = [scoreSelectionCase('c', ['a:x'], [choice(['a:x'])])]
    expect(summarizeSelection(plain).unwanted).toBeNull()
    const markdown = renderSelection(
      plain,
      summarizeSelection(plain),
      [],
      summarizeByModel('selection', null, []),
    )
    expect(markdown).not.toContain('Unwanted')
  })

  it('renders the totals line and per case and per skill tables', () => {
    const all = scores()
    const markdown = renderSelection(
      all,
      summarizeSelection(all),
      [],
      summarizeByModel('selection', null, []),
    )
    expect(markdown).toContain(
      '- Unwanted selections: 3 of 4 attempts (75%) named at least one; 4 in all',
    )
    expect(markdown).toContain('| c1 | 2 of 3 | a:u x2, a:v x1 |')
    expect(markdown).toContain('| c2 | 1 of 1 | a:u x1 |')
    expect(markdown).not.toContain('| c3 | 1 of 1 |')
    expect(markdown).toContain('| a:u | 3 of 4 | 75% |')
    expect(markdown).toContain('| a:v | 1 of 3 | 33% |')
  })

  it('shows n/a rates when labeled cases ran no attempt', () => {
    const none = [scoreSelectionCase('c', ['a:x'], [undefined], ['a:u'])]
    const markdown = renderSelection(
      none,
      summarizeSelection(none),
      [],
      summarizeByModel('selection', null, []),
    )
    expect(markdown).toContain('0 of 0 attempts (n/a)')
    expect(markdown).toContain('| a:u | 0 of 0 | n/a |')
  })
})
