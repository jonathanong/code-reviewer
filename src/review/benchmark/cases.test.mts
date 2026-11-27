import { describe, expect, it } from 'vitest'

import { ReviewError } from '../finding.mts'
import { casesForPillar, isFixtureCase, parseEvalCases } from './cases.mts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

function positive(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'p1',
    repo: 'acme/widgets',
    pr: 3,
    title: 'Title',
    baseSha: SHA_A,
    headSha: SHA_B,
    kind: 'positive',
    reason: 'why',
    expected: [{ pillar: 'security', severity: 'high', path: 'a.ts', lines: [3, 5], claim: 'bad' }],
    ...overrides,
  }
}

function negative(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return positive({ id: 'n1', kind: 'negative', expected: [], ...overrides })
}

function message(raw: unknown): string {
  try {
    parseEvalCases(raw)
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewError)
    return (error as Error).message
  }
  throw new Error('expected a failure')
}

describe('parseEvalCases', () => {
  it('parses positive and negative cases', () => {
    const [first, second] = parseEvalCases([positive(), negative({ reason: undefined })])
    expect(first).toEqual({
      id: 'p1',
      repo: 'acme/widgets',
      pr: 3,
      title: 'Title',
      baseSha: SHA_A,
      headSha: SHA_B,
      kind: 'positive',
      reason: 'why',
      expected: [
        { pillar: 'security', severity: 'high', path: 'a.ts', lines: [3, 5], claim: 'bad' },
      ],
    })
    expect(second).toMatchObject({ id: 'n1', reason: '', expected: [] })
  })

  it('normalizes empty paths and missing lines to null', () => {
    const [item] = parseEvalCases([
      positive({
        expected: [
          { pillar: 'rules', severity: 'low', path: '', claim: 'c' },
          { pillar: 'rules', severity: 'low', path: 7, lines: null, claim: 'c' },
        ],
      }),
    ])
    expect(item?.expected.map((entry) => [entry.path, entry.lines])).toEqual([
      [null, null],
      [null, null],
    ])
  })

  it('parses a fixture case relative to the cases file', () => {
    const fixture: Record<string, unknown> = { ...positive(), fixture: 'fixtures/a' }
    for (const field of ['repo', 'pr', 'baseSha', 'headSha']) delete fixture[field]
    const [item] = parseEvalCases([fixture], '/cases')
    expect(item).toMatchObject({ id: 'p1', fixture: 'fixtures/a', fixtureDir: '/cases/fixtures/a' })
    expect(item).not.toHaveProperty('repo')
    expect(isFixtureCase(item as never)).toBe(true)
    expect(isFixtureCase(parseEvalCases([positive()])[0] as never)).toBe(false)
  })

  it('accepts an owner/name repoId on a fixture case', () => {
    const fixture: Record<string, unknown> = { ...positive(), fixture: 'f', repoId: 'acme/api' }
    for (const field of ['repo', 'pr', 'baseSha', 'headSha']) delete fixture[field]
    expect(parseEvalCases([fixture], '/cases')[0]).toMatchObject({ repoId: 'acme/api' })
    expect(message([{ ...fixture, repoId: 'api' }])).toBe('cases[0]: repoId must be owner/name')
    expect(message([{ ...fixture, repoId: 3 }])).toBe('cases[0]: repoId must be a string')
  })

  it('requires exactly one of fixture or the repo shape', () => {
    expect(message([positive({ fixture: 'f' })])).toBe(
      'cases[0]: a fixture case must not set repo, pr, baseSha, or headSha',
    )
    const bare = positive()
    for (const field of ['repo', 'pr', 'baseSha', 'headSha']) delete bare[field]
    expect(message([bare])).toBe('cases[0]: repo must be a string')
    expect(message([{ ...bare, fixture: '' }])).toBe('cases[0]: fixture must be a directory')
    expect(message([{ ...bare, fixture: 3 }])).toBe('cases[0]: fixture must be a string')
  })

  it('keeps the description a mined case records for its head', () => {
    const [parsed] = parseEvalCases([positive({ body: 'As it read then.' })])
    expect(parsed).toMatchObject({ pr: 3, body: 'As it read then.' })
    expect(parseEvalCases([positive()])[0]).not.toHaveProperty('body')
  })

  it('rejects non-array input and duplicate ids', () => {
    expect(message({})).toBe('Eval cases must be a JSON array.')
    expect(message([positive(), positive()])).toBe('Duplicate eval case id: p1')
  })

  it('rejects malformed cases', () => {
    expect(message([1])).toBe('cases[0]: must be an object')
    expect(message([positive({ id: 4 })])).toBe('cases[0]: id must be a string')
    expect(message([positive({ repo: 'bad' })])).toBe('cases[0]: repo must be owner/name')
    expect(message([positive({ baseSha: 'abc' })])).toBe(
      'cases[0]: baseSha and headSha must be full SHAs',
    )
    expect(message([positive({ headSha: 'abc' })])).toBe(
      'cases[0]: baseSha and headSha must be full SHAs',
    )
    expect(message([positive({ kind: 'other' })])).toBe(
      'cases[0]: kind must be positive or negative',
    )
    expect(message([positive({ pr: 0 })])).toBe('cases[0]: pr must be a positive integer')
    expect(message([positive({ pr: 'x' })])).toBe('cases[0]: pr must be a positive integer')
    expect(message([positive({ body: 4 })])).toBe('cases[0]: body must be a string')
    expect(message([positive({ expected: 'x' })])).toBe('cases[0]: expected must be an array')
    expect(message([positive({ expected: [] })])).toBe(
      'cases[0]: a positive case needs an expected finding',
    )
    expect(message([negative({ expected: [positive().expected] })])).toContain(
      'cases[0].expected[0]: must be an object',
    )
  })

  it('rejects a negative case with expectations', () => {
    const entry = { pillar: 'rules', severity: 'low', claim: 'c' }
    expect(message([negative({ expected: [entry] })])).toBe(
      'cases[0]: a negative case has no expected findings',
    )
  })

  it('rejects malformed expectations', () => {
    const entry = (extra: Record<string, unknown>) =>
      message([
        positive({ expected: [{ pillar: 'rules', severity: 'low', claim: 'c', ...extra }] }),
      ])
    expect(entry({ pillar: 'x' })).toBe('cases[0].expected[0]: unknown pillar')
    expect(entry({ severity: 'x' })).toBe('cases[0].expected[0]: unknown severity')
    expect(entry({ claim: 3 })).toBe('cases[0].expected[0]: claim must be a string')
    expect(entry({ lines: [1] })).toBe('cases[0].expected[0]: lines must be [start, end] or null')
    expect(entry({ lines: 'x' })).toBe('cases[0].expected[0]: lines must be [start, end] or null')
    for (const lines of [
      [0, 2],
      [3, 2],
      [1.5, 2],
      [1, 2.5],
      ['1', 2],
    ]) {
      expect(entry({ lines })).toBe(
        'cases[0].expected[0]: lines must be ascending positive integers',
      )
    }
  })
})

describe('expectedSkills', () => {
  it('accepts full names and any-of groups, and leaves it off otherwise', () => {
    const [with_, without] = parseEvalCases([
      positive({ expectedSkills: ['r:testing-rules', ['a:x', 'b:y']] }),
      negative(),
    ])
    expect(with_?.expectedSkills).toEqual(['r:testing-rules', ['a:x', 'b:y']])
    expect(without).not.toHaveProperty('expectedSkills')
  })

  it('rejects empty, non-array, and bare or non-string names', () => {
    const cases: Array<[unknown, string]> = [
      [[], 'expectedSkills must be a non-empty array'],
      ['r:testing-rules', 'expectedSkills must be a non-empty array'],
      [['testing-rules'], 'expectedSkills names must be full plugin:skill strings'],
      [[''], 'expectedSkills names must be full plugin:skill strings'],
      [[1], 'expectedSkills names must be full plugin:skill strings'],
      [[['a:x', 'bare']], 'expectedSkills names must be full plugin:skill strings'],
      [[[]], 'an expectedSkills any-of group must not be empty'],
    ]
    for (const [expectedSkills, text] of cases)
      expect(message([positive({ expectedSkills })])).toBe(`cases[0]: ${text}`)
  })
})

describe('expectedRules', () => {
  const skills = ['r:testing-rules']
  const rules = [{ skill: 'r:testing-rules', text: 'MUST NOT x' }]

  it('is kept when it names a listed skill and absent otherwise', () => {
    const [with_, without] = parseEvalCases([
      positive({ expectedSkills: skills, expectedRules: rules }),
      positive({ id: 'p2', expectedSkills: skills }),
    ])
    expect(with_?.expectedRules).toEqual(rules)
    expect(without).not.toHaveProperty('expectedRules')
  })

  it('rejects a rule of a skill the case does not list', () => {
    expect(message([positive({ expectedRules: rules })])).toBe(
      'cases[0]: expectedRules skill r:testing-rules is not in expectedSkills',
    )
  })
})

describe('casesForPillar', () => {
  it('keeps positives for the pillar and every negative', () => {
    const cases = parseEvalCases([
      positive(),
      positive({
        id: 'p2',
        expected: [{ pillar: 'rules', severity: 'low', claim: 'c' }],
      }),
      negative(),
    ])
    expect(casesForPillar(cases, 'security').map((item) => item.id)).toEqual(['p1', 'n1'])
    expect(casesForPillar(cases, 'design').map((item) => item.id)).toEqual(['n1'])
  })

  it('reads an optional review time and rejects one that is not a time', () => {
    expect(parseEvalCases([negative({ reviewedAt: '2030-01-01T07:46:00Z' })])[0]?.reviewedAt).toBe(
      '2030-01-01T07:46:00Z',
    )
    expect(parseEvalCases([negative()])[0]?.reviewedAt).toBeUndefined()
    expect(() => parseEvalCases([negative({ reviewedAt: 'soon' })])).toThrow(
      'reviewedAt must be an ISO time',
    )
    expect(() => parseEvalCases([negative({ reviewedAt: 5 })])).toThrow(
      'reviewedAt must be an ISO time',
    )
  })

  it('leaves a focus-only case out of every pillar', () => {
    const focus = [{ point: 'p', expectedStatus: 'holds', reason: 'r' }]
    const cases = parseEvalCases([negative(), negative({ id: 'f1', focusOnly: true, focus })])
    expect(cases[1]?.focusOnly).toBe(true)
    expect(casesForPillar(cases, 'design').map((item) => item.id)).toEqual(['n1'])
  })

  it('rejects a focus-only case that is not a negative with focus points', () => {
    const focus = [{ point: 'p', expectedStatus: 'holds', reason: 'r' }]
    expect(() => parseEvalCases([negative({ focusOnly: true })])).toThrow(
      'a focusOnly case is a negative with focus points',
    )
    expect(() => parseEvalCases([positive({ focusOnly: true, focus })])).toThrow(
      'a focusOnly case is a negative with focus points',
    )
    expect(() => parseEvalCases([negative({ focusOnly: 'yes', focus })])).toThrow(
      'focusOnly must be a boolean',
    )
    expect(parseEvalCases([negative({ focusOnly: false })])[0]?.focusOnly).toBeUndefined()
  })
})
