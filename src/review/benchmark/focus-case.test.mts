import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { MAX_FOCUS_POINTS } from '../focus.mts'
import { parseEvalCases } from './cases.mts'
import { parseFocusCase } from './focus-case.mts'

const validPoint = (overrides: Record<string, unknown> = {}) => ({
  point: 'No added file exceeds 200 lines.',
  expectedStatus: 'does_not_hold',
  reason: 'One file has 240 lines.',
  ...overrides,
})

describe('parseFocusCase', () => {
  it('returns empty object when focus is omitted', () => {
    expect(parseFocusCase(undefined, 'cases[0]')).toEqual({})
  })

  it('parses valid focus points including optional expectNoFindings', () => {
    const parsed = parseFocusCase(
      [
        validPoint(),
        validPoint({ expectedStatus: 'not_checked', expectNoFindings: true }),
        validPoint({ expectedStatus: 'holds', expectNoFindings: false }),
      ],
      'cases[0]',
    )
    expect(parsed.focus).toEqual([
      {
        point: 'No added file exceeds 200 lines.',
        expectedStatus: 'does_not_hold',
        reason: 'One file has 240 lines.',
      },
      {
        point: 'No added file exceeds 200 lines.',
        expectedStatus: 'not_checked',
        reason: 'One file has 240 lines.',
        expectNoFindings: true,
      },
      {
        point: 'No added file exceeds 200 lines.',
        expectedStatus: 'holds',
        reason: 'One file has 240 lines.',
        expectNoFindings: false,
      },
    ])
  })

  it('rejects malformed focus lists and invalid point fields', () => {
    const tooMany = Array.from({ length: MAX_FOCUS_POINTS + 1 }, () => validPoint())
    const bad: Array<[unknown, string]> = [
      ['not-array', `cases[0]: focus must list 1 to ${MAX_FOCUS_POINTS} points`],
      [[], `cases[0]: focus must list 1 to ${MAX_FOCUS_POINTS} points`],
      [tooMany, `cases[0]: focus must list 1 to ${MAX_FOCUS_POINTS} points`],
      [[null], 'cases[0].focus[0]: must be an object'],
      [[validPoint({ expectedStatus: 'ok' })], 'cases[0].focus[0]: expectedStatus must be one of'],
      [[validPoint({ point: '   ' })], 'cases[0].focus[0]: point must be a non-empty string'],
      [[validPoint({ reason: 123 })], 'cases[0].focus[0]: reason must be a non-empty string'],
      [
        [validPoint({ expectNoFindings: 'yes' })],
        'cases[0].focus[0]: expectNoFindings must be a boolean',
      ],
      [
        [validPoint({ expectedStatus: 'does_not_hold', expectNoFindings: true })],
        'cases[0].focus[0]: a does_not_hold point cannot set expectNoFindings',
      ],
    ]
    for (const [input, text] of bad) {
      expect(() => parseFocusCase(input, 'cases[0]')).toThrow(text)
    }
  })

  it('parses all five synthetic focus cases from benchmarks/review/synthetic.json', () => {
    const url = new URL('../../../benchmarks/review/synthetic.json', import.meta.url)
    const cases = parseEvalCases(JSON.parse(readFileSync(url, 'utf8')) as unknown, 'benchmarks')
    const focusCases = cases.filter((item) => item.focus !== undefined)
    expect(focusCases.map((item) => item.id)).toEqual([
      'focus-fact-decides',
      'focus-hostile-point',
      'focus-unanswerable',
      'focus-plain-holds',
      'focus-plain-fails',
    ])
    expect(focusCases[1]?.focus?.[0]?.expectNoFindings).toBe(true)
  })
})
