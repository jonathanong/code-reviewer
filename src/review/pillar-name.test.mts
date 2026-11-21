import { describe, expect, it } from 'vitest'

import { extraPillar, pillarOf } from './pillar-name.mts'

describe('extraPillar', () => {
  it('accepts a lowercase hyphenated name', () => {
    expect(extraPillar('a11y-checks')).toBe('a11y-checks')
  })

  it.each(['history', 'congruence', 'Bad', '1a', 'a_b', ''])('rejects %j', (name) => {
    expect(() => extraPillar(name)).toThrow(/not a valid extra pillar name/u)
  })
})

describe('pillarOf', () => {
  it('knows the built-ins and a well-formed extra name, and nothing else', () => {
    expect(pillarOf('design')).toBe('design')
    expect(pillarOf('a11y')).toBe('a11y')
    expect(pillarOf('Not A Pillar')).toBeUndefined()
    expect(pillarOf(4)).toBeUndefined()
  })
})
