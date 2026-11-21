import { describe, expect, it } from 'vitest'

import type { SkillChoice } from '../run/types.mts'
import { summarizeByModel } from './model-usage.mts'
import { renderSelection, scoreSelectionCase, summarizeSelection } from './selection-score.mts'
import type { Usage } from './usage.mts'

const choice = (selected: string[], extra: Partial<SkillChoice> = {}): SkillChoice => ({
  selected,
  available: 10,
  usage: null,
  ...extra,
})

const usage: Usage = {
  costUsd: 0.5,
  turns: 1,
  durationMs: 1,
  inputTokens: 100,
  outputTokens: 10,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  byModel: {
    haiku: {
      inputTokens: 100,
      outputTokens: 10,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      costUsd: 0.5,
    },
  },
}

describe('scoreSelectionCase', () => {
  it('hits only when every expected skill is selected, and names what was missed', () => {
    const score = scoreSelectionCase(
      'c1',
      ['a:x', 'a:y'],
      [choice(['a:x', 'a:y', 'a:z']), choice(['a:x'])],
    )
    expect(score.expected).toEqual(['a:x', 'a:y'])
    expect(score.attempts).toEqual([
      { attempt: 1, hit: true, missed: [], selected: 3 },
      { attempt: 2, hit: false, missed: ['a:y'], selected: 1 },
    ])
  })

  it('accepts any one skill of an any-of group', () => {
    const score = scoreSelectionCase('c1', [['a:x', 'b:y']], [choice(['b:y']), choice([])])
    expect(score.expected).toEqual(['a:x | b:y'])
    expect(score.attempts.map((attempt) => attempt.hit)).toEqual([true, false])
    expect(score.attempts[1]?.missed).toEqual(['a:x | b:y'])
  })

  it('does not score errored or missing attempts', () => {
    const score = scoreSelectionCase(
      'c1',
      ['a:x'],
      [choice([], { error: 'timeout' }), undefined, choice(['a:x'])],
    )
    expect(score.errors).toEqual(['attempt 1: timeout'])
    expect(score.notRun).toEqual([2])
    expect(score.attempts).toEqual([{ attempt: 3, hit: true, missed: [], selected: 1 }])
  })
})

describe('summarizeSelection and renderSelection', () => {
  const scores = [
    scoreSelectionCase('c1', ['a:x', 'a:y'], [choice(['a:x', 'a:y']), choice(['a:x'])]),
    scoreSelectionCase('c2', ['a:x'], [choice(['a:x', 'a:q', 'a:r']), choice([], { error: 'e' })]),
    scoreSelectionCase('c3', ['a:z'], [undefined]),
  ]

  it('totals hits, mean selected, and hits per expected skill', () => {
    const summary = summarizeSelection(scores)
    expect(summary).toMatchObject({
      cases: 3,
      attempts: 3,
      hits: 2,
      meanSelected: 2,
      errors: 1,
      notRun: 1,
    })
    expect(summary.hitRate).toBeCloseTo(2 / 3)
    expect(summary.skills).toEqual([
      { skill: 'a:x', attempts: 3, hits: 3 },
      { skill: 'a:y', attempts: 2, hits: 1 },
      { skill: 'a:z', attempts: 0, hits: 0 },
    ])
  })

  it('has no rate when nothing was scored', () => {
    expect(summarizeSelection([])).toMatchObject({ hitRate: null, meanSelected: null })
  })

  it('renders totals, a row per case and skill, tokens by model, and problems', () => {
    const markdown = renderSelection(
      scores,
      summarizeSelection(scores),
      [usage, usage],
      summarizeByModel('selection', null, [usage, usage, null]),
    )
    expect(markdown).toContain('- Hit rate: 2 of 3 (67%)')
    expect(markdown).toContain('- Mean skills selected per attempt: 2.0')
    expect(markdown).toContain('- Cost: $1.00')
    expect(markdown).toContain('| c1 | a:x; a:y | 1 of 2 | a:y x1 | 1.5 | 0 |')
    expect(markdown).toContain('| c2 | a:x | 1 of 1 |  | 3.0 | 1 |')
    expect(markdown).toContain('| c3 | a:z | 0 of 0 |  | n/a | 1 |')
    expect(markdown).toContain('| a:y | 1 of 2 | 50% |')
    expect(markdown).toContain('| a:z | 0 of 0 | n/a |')
    expect(markdown).toContain(
      '| selection | - | haiku | 2 of 2 of 3 | 200 / 100 | n/a | n/a | 20 / 10 | $1.00 / $0.50 |',
    )
    expect(markdown).toContain('- c2 attempt 2: e')
    expect(markdown).toContain('- c3 attempt 1: not run')
  })

  it('shows n/a and omits errors when there is nothing to report', () => {
    const markdown = renderSelection(
      [],
      summarizeSelection([]),
      [],
      summarizeByModel('selection', null, []),
    )
    expect(markdown).toContain('- Mean skills selected per attempt: n/a')
    expect(markdown).toContain('- Cost: n/a')
    expect(markdown).not.toContain('## Errors')
  })
})
