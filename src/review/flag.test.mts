import { describe, expect, it } from 'vitest'

import { VERIFIER_OUTPUT_SCHEMA, validateVerifierOutput } from './benchmark/verifier-run.mts'
import { ReviewError, parseReviewInput } from './finding.mts'
import { FLAG_DEFINITIONS, FLAG_KINDS, FLAGS_SCHEMA } from './flag.mts'
import { REVIEW_VERIFIER_SCHEMA } from './run/verify-schema.mts'

describe('flags', () => {
  it('fixes the ten kinds the owner decided, each defined', () => {
    expect(FLAG_KINDS).toEqual([
      'architecture',
      'acceptance-criteria',
      'feature-sense',
      'wrong-intent',
      'design',
      'broken-workflow',
      'safeguard-weakened',
      'irreversible',
      'new-service',
      'rule-workaround',
    ])
    expect(Object.values(FLAG_DEFINITIONS).every((text) => text.length > 0)).toBe(true)
    expect(FLAGS_SCHEMA.items.properties.kind.enum).toEqual(FLAG_KINDS)
  })

  it('is part of the verifier output schemas, and optional', () => {
    expect(VERIFIER_OUTPUT_SCHEMA.properties.flags).toBe(FLAGS_SCHEMA)
    expect(REVIEW_VERIFIER_SCHEMA.properties.flags).toBe(FLAGS_SCHEMA)
    expect(VERIFIER_OUTPUT_SCHEMA.required).not.toContain('flags')
  })

  it('accepts a flag with or without where, and trims text', () => {
    const review = parseReviewInput({
      flags: [
        { kind: 'irreversible', concern: ' Drops it. ', where: ' a.sql:3 ' },
        { kind: 'design', concern: 'Odd.', where: '' },
      ],
    })
    expect(review.flags).toEqual([
      { kind: 'irreversible', concern: 'Drops it.', where: 'a.sql:3' },
      { kind: 'design', concern: 'Odd.' },
    ])
    expect(parseReviewInput({}).flags).toBeUndefined()
    expect(parseReviewInput({ flags: [] }).flags).toBeUndefined()
  })

  it('rejects an unknown kind, a missing concern and a non-object', () => {
    expect(() => parseReviewInput({ flags: [{ kind: 'size', concern: 'big' }] })).toThrow(
      ReviewError,
    )
    expect(() => parseReviewInput({ flags: [{ kind: 'design' }] })).toThrow(ReviewError)
    expect(() => parseReviewInput({ flags: ['design'] })).toThrow('flags[0] must be an object.')
  })

  it('reaches the verifier output', () => {
    const flags = [{ kind: 'new-service', concern: 'Adds a vendor.' }]
    expect(validateVerifierOutput({ summary: 's', findings: [], flags }, 0).flags).toEqual(flags)
    expect(validateVerifierOutput({ summary: 's', findings: [] }, 0).flags).toBeUndefined()
  })
})
