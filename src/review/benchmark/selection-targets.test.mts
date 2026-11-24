import { describe, expect, it } from 'vitest'

import { ReviewError } from '../finding.mts'
import type { SkillChoice } from '../run/types.mts'
import {
  parseSelectionTargets,
  renderTargetSelection,
  scoreSelectionTargetCase,
  summarizeSelectionTargets,
  targetSelectionTotals,
} from './selection-targets.mts'

const KNOWN = ['alpha', 'beta']
const choice = (targets: string[] | undefined, error?: string): SkillChoice => ({
  selected: [],
  ...(targets === undefined ? {} : { targets }),
  ...(error === undefined ? {} : { error }),
  available: 1,
  usage: null,
})

describe('parseSelectionTargets', () => {
  it('parses optional expectedTargets and unwantedTargets', () => {
    expect(parseSelectionTargets(undefined, undefined, 'cases[0]', KNOWN)).toEqual({})
    expect(parseSelectionTargets(['alpha'], ['beta'], 'cases[0]', KNOWN)).toEqual({
      expectedTargets: ['alpha'],
      unwantedTargets: ['beta'],
    })
  })

  it.each([
    ['empty expectedTargets', [], undefined, 'expectedTargets must be a non-empty array'],
    ['unknown target', ['nope'], undefined, 'expectedTargets contains unknown target "nope"'],
    ['duplicate target', ['alpha', 'alpha'], undefined, 'expectedTargets repeats alpha'],
    ['overlap', ['alpha'], ['alpha'], 'unwantedTargets target alpha is also in expectedTargets'],
  ])('rejects %s', (_label, exp, unw, message) => {
    expect(() => parseSelectionTargets(exp, unw, 'cases[0]', KNOWN)).toThrow(ReviewError)
    expect(() => parseSelectionTargets(exp, unw, 'cases[0]', KNOWN)).toThrow(message)
  })
})

describe('scoreSelectionTargetCase and rendering', () => {
  it('scores hits, misses, unwanted selections, errors, and not-run attempts', () => {
    const s1 = scoreSelectionTargetCase(
      'c1',
      ['alpha'],
      ['beta'],
      [choice(['alpha']), choice(['beta']), choice(undefined), choice([], 'boom'), undefined],
    )
    expect(s1.attempts).toEqual([
      { attempt: 1, hit: true, missed: [], unwanted: [], selected: 1 },
      { attempt: 2, hit: false, missed: ['alpha'], unwanted: ['beta'], selected: 1 },
      { attempt: 3, hit: false, missed: ['alpha'], unwanted: [], selected: 0 },
    ])
    expect(s1.errors).toEqual(['attempt 4: boom'])
    expect(s1.notRun).toEqual([5])

    const summary = summarizeSelectionTargets([s1])
    expect(summary).toEqual({
      cases: 1,
      attempts: 3,
      hits: 1,
      hitRate: 1 / 3,
      attemptsWithUnwanted: 1,
      unwantedSelections: 1,
    })
    expect(targetSelectionTotals(summary!)).toBe(
      '- Target selection: 1 of 3 attempts (33%) matched; unwanted in 1 of 3 (1 total)',
    )
    const rendered = renderTargetSelection([s1]).join('\n')
    expect(rendered).toContain('## Target selection per case')
    expect(rendered).toContain('| c1 | alpha | beta | 1 of 3 | alpha x2 | beta x1 |')
  })

  it('handles empty scores and zero scored attempts cleanly', () => {
    expect(summarizeSelectionTargets([])).toBeNull()
    expect(renderTargetSelection([])).toEqual([])
    const empty = scoreSelectionTargetCase('c0', ['alpha'], [], [undefined])
    const summary = summarizeSelectionTargets([empty])
    expect(summary?.hitRate).toBeNull()
    expect(targetSelectionTotals(summary!)).toContain('0 of 0 attempts (n/a)')
  })
})
