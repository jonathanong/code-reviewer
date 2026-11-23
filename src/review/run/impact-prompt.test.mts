import { describe, expect, it } from 'vitest'

import { BASIS_MAX, readImpact } from '../impact.mts'
import { parseReviewInput } from '../finding.mts'
import { renderHeader } from '../render.mts'
import { checkedImpact, impactLines, withImpact } from './impact-prompt.mts'
import { REVIEW_VERIFIER_SCHEMA, buildVerifierRunPrompt, parseReviewVerifier } from './verify.mts'
import type { VerifierInput } from './verify.mts'

const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: null, hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}

describe('the impact block', () => {
  it('is added only when asked, before the untrusted-data line, and defines the kinds', () => {
    const plain = buildVerifierRunPrompt(INPUT)
    expect(buildVerifierRunPrompt({ ...INPUT, impact: false })).toBe(plain)
    const prompt = buildVerifierRunPrompt({ ...INPUT, impact: true })
    expect(prompt).toContain('## Impact of the change')
    expect(prompt).toContain('a removed or renamed flag, field, export, route or type')
    expect(prompt).toContain('a new dependency on a remote service or another repository')
    expect(prompt).toContain('Never answer `maintenance` for what you could not judge.')
    expect(prompt).toContain('those definitions win')
    expect(prompt.indexOf('## Impact')).toBeLessThan(prompt.indexOf('untrusted data'))
    expect(impactLines(undefined)).toEqual([])
  })
})

describe('withImpact', () => {
  it('is the same schema object when not asked, and an optional object field when asked', () => {
    expect(withImpact(REVIEW_VERIFIER_SCHEMA, false)).toBe(REVIEW_VERIFIER_SCHEMA)
    const schema = withImpact(REVIEW_VERIFIER_SCHEMA, true)
    expect(schema.properties).toHaveProperty('impact.required', ['kind'])
    expect(REVIEW_VERIFIER_SCHEMA.properties).not.toHaveProperty('impact')
    expect(schema.required).toEqual(REVIEW_VERIFIER_SCHEMA.required)
  })
})

describe('readImpact, checkedImpact and parseReviewVerifier', () => {
  it('keeps a known kind, collapses the basis to one line and caps it', () => {
    expect(readImpact({ kind: 'breaking', basis: ' removes\n the flag ' })).toEqual({
      kind: 'breaking',
      basis: 'removes the flag',
    })
    expect(readImpact({ kind: 'unsure' })).toEqual({ kind: 'unsure' })
    expect(readImpact({ kind: 'unsure', basis: '  ' })).toEqual({ kind: 'unsure' })
    expect(readImpact({ kind: 'unsure', basis: 4 })).toEqual({ kind: 'unsure' })
    const long = readImpact({ kind: 'breaking', basis: 'x'.repeat(500) })
    expect(long?.basis).toHaveLength(BASIS_MAX)
    expect(long?.basis?.endsWith('…')).toBe(true)
  })

  it('ignores an answer that is not an impact', () => {
    for (const raw of [undefined, null, 'breaking', [], { kind: 'major' }, {}]) {
      expect(readImpact(raw)).toBeUndefined()
    }
  })

  it('keeps the impact only for a run that asked for it', () => {
    const raw = { kind: 'maintenance', basis: 'a docs fix' }
    expect(checkedImpact(raw, true)).toEqual({ impact: raw })
    expect(checkedImpact(raw, false)).toEqual({})
    expect(checkedImpact('nonsense', true)).toEqual({})
    const run = { structured: { summary: 's', findings: [], impact: raw }, skills: [], usage: {} }
    expect(parseReviewVerifier(run as never, 0)).not.toHaveProperty('impact')
  })
})

describe('review.json and the header', () => {
  const PLAIN = { effort: 'high', summary: 'S', skipped: [], findings: [], questions: [] }
  const HEAD = 'a'.repeat(40)

  it('accepts a hand-written impact, and rejects one that is not', () => {
    expect(parseReviewInput({ ...PLAIN, impact: { kind: 'architectural' } }).impact).toEqual({
      kind: 'architectural',
    })
    expect(parseReviewInput(PLAIN)).not.toHaveProperty('impact')
    expect(() => parseReviewInput({ ...PLAIN, impact: { kind: 'major' } })).toThrow('impact')
  })

  it('puts the class line directly under the reviewed line, and changes nothing else', () => {
    const input = parseReviewInput({ ...PLAIN, impact: { kind: 'maintenance', basis: 'a bump' } })
    const body = renderHeader(input, HEAD, ['package.json', 'pnpm-lock.yaml'])
    const lines = body.split('\n\n')
    expect(lines[2]).toMatch(/^Reviewed `a+` at high effort · no findings$/u)
    expect(lines[3]).toBe('**Class:** maintenance (a bump) · dependencies-only')
    expect(lines[4]).toBe('S')
    const without = renderHeader(parseReviewInput(PLAIN), HEAD)
    expect(without).not.toContain('Class')
    expect(without.split('\n\n')[0]).toBe(lines[0])
  })
})
