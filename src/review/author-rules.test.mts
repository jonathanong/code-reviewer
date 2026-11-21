import { describe, expect, it } from 'vitest'

import { authorReview, effectiveAuthorRules, isDependabot } from './author-rules.mts'

describe('authorReview', () => {
  it('gives Dependabot a light review without configuration', () => {
    expect(authorReview('dependabot[bot]', true, [])).toBe('light')
    expect(authorReview('app/dependabot', true, [])).toBe('light')
    expect(authorReview('dependabot', true, [])).toBe('light')
  })

  it('does not treat a person named dependabot as the bot', () => {
    expect(isDependabot('dependabot', false)).toBe(false)
    expect(authorReview('dependabot', false, [])).toBeUndefined()
    expect(isDependabot(null, true)).toBe(false)
    expect(authorReview(null, false, [])).toBeUndefined()
    expect(authorReview(undefined, true, [])).toBeUndefined()
  })

  it('matches a configured login in any form and lets it override the built-in rule', () => {
    const rules = [
      { login: 'Renovate[bot]', review: 'skip' as const },
      { login: 'dependabot', review: 'skip' as const },
    ]
    expect(authorReview('app/renovate', true, rules)).toBe('skip')
    expect(authorReview('dependabot[bot]', true, rules)).toBe('skip')
    expect(authorReview('someone', false, rules)).toBeUndefined()
  })
})

describe('effectiveAuthorRules', () => {
  it('adds the built-in rule unless dependabot is configured', () => {
    const own = { login: 'renovate', review: 'skip' as const }
    expect(effectiveAuthorRules([own])).toEqual([
      own,
      { login: 'dependabot[bot]', review: 'light' },
    ])
    const override = { login: 'app/dependabot', review: 'skip' as const }
    expect(effectiveAuthorRules([override])).toEqual([override])
  })
})
