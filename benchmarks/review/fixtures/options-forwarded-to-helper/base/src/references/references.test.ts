import { describe, expect, it } from 'vitest'

import { nextReference, parseReference, sortedReferences } from './references.ts'

describe('references', () => {
  it('parses a custom prefix only when asked for it', () => {
    expect(parseReference('crn-2026-000007')).toBeUndefined()
    expect(parseReference('crn-2026-000007', { prefix: 'crn' })?.sequence).toBe(7)
  })

  it('sorts newest first and drops other text', () => {
    const lines = ['inv-2025-000900', 'note', 'inv-2026-000002', 'inv-2026-000001']
    expect(sortedReferences(lines).map((reference) => reference.sequence)).toEqual([2, 1, 900])
  })

  it('continues numbering for the year and the prefix', () => {
    expect(nextReference(['inv-2026-000002'], 2026)).toBe('inv-2026-000003')
    expect(nextReference(['crn-2026-000041'], 2026, { prefix: 'crn' })).toBe('crn-2026-000042')
    expect(nextReference([], 2026)).toBe('inv-2026-000001')
  })
})
