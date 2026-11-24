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

  it('resolves target references verbatim from target files and rejects invalid target usage', () => {
    const targets = [{ name: 'my-target', when: 'W.', point: 'Verbatim target point.' }]
    const parsed = parseFocusCase(
      [{ target: 'my-target', expectedStatus: 'does_not_hold', reason: 'Overlap impossible.' }],
      'cases[0]',
      targets,
    )
    expect(parsed.focus).toEqual([
      {
        point: 'Verbatim target point.',
        target: 'my-target',
        expectedStatus: 'does_not_hold',
        reason: 'Overlap impossible.',
      },
    ])
    expect(() =>
      parseFocusCase(
        [{ point: 'a', target: 'my-target', expectedStatus: 'holds', reason: 'r' }],
        'cases[0]',
        targets,
      ),
    ).toThrow('set only one of point and target')
    expect(() =>
      parseFocusCase(
        [{ target: 'missing', expectedStatus: 'holds', reason: 'r' }],
        'cases[0]',
        targets,
      ),
    ).toThrow('unknown target "missing"')
    expect(() =>
      parseFocusCase([{ target: ' ', expectedStatus: 'holds', reason: 'r' }], 'cases[0]', targets),
    ).toThrow('target must be a non-empty string')
  })

  it('parses the synthetic focus cases and vouchington-6282 target focus case', () => {
    const synthUrl = new URL('../../../benchmarks/review/synthetic.json', import.meta.url)
    const synth = parseEvalCases(
      JSON.parse(readFileSync(synthUrl, 'utf8')) as unknown,
      'benchmarks',
    )
    const focusCases = synth.filter((item) => item.focus !== undefined)
    expect(focusCases.map((item) => item.id)).toEqual([
      'focus-fact-decides',
      'focus-hostile-point',
      'focus-unanswerable',
      'focus-plain-holds',
      'focus-plain-fails',
      'focus-target-guard-needed',
    ])
    expect(focusCases[1]?.focus?.[0]?.expectNoFindings).toBe(true)

    const realUrl = new URL('../../../benchmarks/review/cases.json', import.meta.url)
    const real = parseEvalCases(JSON.parse(readFileSync(realUrl, 'utf8')) as unknown, 'benchmarks')
    const guard = real.find((item) => item.id === 'vouchington-6282')
    expect(guard?.focus).toEqual([
      {
        target: 'unneeded-concurrency-guard',
        point:
          'The change adds a guard against two runs of the same code overlapping. Find every caller of the guarded code and how each is scheduled or enqueued, then look for what already serialises them: a queue ordering or group key with concurrency 1, a fixed job id or dedupe key, a single schedule, a unique constraint, an existing lock. Claim to test: two runs can overlap, so the guard is needed.',
        expectedStatus: 'does_not_hold',
        reason:
          'The cleanup job is enqueued with one ordering key at concurrency 1, so two runs never overlap.',
      },
    ])
    const quiet = real.find((item) => item.id === 'vouchington-6254')?.focus?.[0]
    expect(quiet?.target).toBe('unneeded-concurrency-guard')
    expect(quiet?.expectedStatus).toBe('holds')
    expect(quiet?.expectNoFindings).toBe(true)
  })
})
