import { describe, expect, it } from 'vitest'

import { ReviewError } from '../finding.mts'
import { parseEvalCases } from './cases.mts'
import { parseUnwantedSkills } from './unwanted-skills.mts'

const SHA = 'a'.repeat(40)

const raw = (extra: Record<string, unknown>) => ({
  id: 'c1',
  repo: 'acme/widgets',
  pr: 1,
  title: 'T',
  baseSha: SHA,
  headSha: SHA,
  kind: 'negative',
  expected: [],
  ...extra,
})

describe('parseUnwantedSkills', () => {
  it('returns undefined when absent and the names when valid', () => {
    expect(parseUnwantedSkills(undefined, undefined, 'w')).toBeUndefined()
    expect(parseUnwantedSkills(['a:x', 'b:y'], ['a:z', ['c:p', 'c:q']], 'w')).toEqual([
      'a:x',
      'b:y',
    ])
    expect(parseUnwantedSkills(['a:x'], undefined, 'w')).toEqual(['a:x'])
  })

  it('rejects malformed, overlapping, and repeated names naming the key', () => {
    const fails: Array<[unknown, string]> = [
      [[], 'w: unwantedSkills must be a non-empty array'],
      ['a:x', 'w: unwantedSkills must be a non-empty array'],
      [['bare'], 'w: unwantedSkills names must be full plugin:skill strings'],
      [[1], 'w: unwantedSkills names must be full plugin:skill strings'],
      [['a:b:c'], 'w: unwantedSkills names must be full plugin:skill strings'],
      [['a:z'], 'w: unwantedSkills skill a:z is also in expectedSkills'],
      [['c:q'], 'w: unwantedSkills skill c:q is also in expectedSkills'],
      [['a:x', 'a:x'], 'w: unwantedSkills repeats a:x'],
    ]
    for (const [value, text] of fails) {
      const attempt = () => parseUnwantedSkills(value, ['a:z', ['c:p', 'c:q']], 'w')
      expect(attempt).toThrow(ReviewError)
      expect(attempt).toThrow(text)
    }
  })
})

describe('parseEvalCases unwantedSkills', () => {
  it('keeps the field only on cases that declare it', () => {
    const [with_, without] = parseEvalCases([
      raw({ expectedSkills: ['a:z'], unwantedSkills: ['a:x'] }),
      raw({ id: 'c2' }),
    ])
    expect(with_?.unwantedSkills).toEqual(['a:x'])
    expect(without).not.toHaveProperty('unwantedSkills')
  })

  it('fails on overlap with expectedSkills', () => {
    expect(() =>
      parseEvalCases([raw({ expectedSkills: ['a:x'], unwantedSkills: ['a:x'] })]),
    ).toThrow('cases[0]: unwantedSkills skill a:x is also in expectedSkills')
  })
})
