import { describe, expect, it } from 'vitest'

import { ReviewError } from '../finding.mts'
import { parseExpectedRules } from './expected-rules.mts'

const skills = ['a:one', ['a:two', 'a:three']]

describe('parseExpectedRules', () => {
  it('is unset when the case declares none', () => {
    expect(parseExpectedRules(undefined, skills, 'c')).toBeUndefined()
  })

  it('accepts a rule of a listed skill, including an any-of group member', () => {
    const rules = [
      { skill: 'a:one', text: 'MUST NOT x' },
      { skill: 'a:three', text: 'y' },
    ]
    expect(parseExpectedRules(rules, skills, 'c')).toEqual(rules)
  })

  it.each([
    ['not an array', 'x'],
    ['an empty array', []],
    ['an entry that is not an object', [null]],
    ['a missing text', [{ skill: 'a:one' }]],
    ['a blank text', [{ skill: 'a:one', text: ' ' }]],
    ['a skill that is not listed', [{ skill: 'a:nine', text: 'x' }]],
  ])('rejects %s', (_name, value) => {
    expect(() => parseExpectedRules(value, skills, 'cases[0]')).toThrow(ReviewError)
  })

  it('rejects a rule when the case lists no skills', () => {
    expect(() => parseExpectedRules([{ skill: 'a:one', text: 'x' }], undefined, 'c')).toThrow(
      'not in expectedSkills',
    )
  })
})
