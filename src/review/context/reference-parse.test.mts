import { describe, expect, it } from 'vitest'

import { parseReferences } from './reference-parse.mts'

describe('parseReferences', () => {
  it('reads reverts by sha and by subject, not both for one commit', () => {
    const found = parseReferences([
      `Revert "Add widget"\n\nThis reverts commit ${'A'.repeat(40)}.\n`,
      'Revert "Add gadget"\n\nbody',
    ])
    expect(found).toEqual({ shas: ['a'.repeat(40)], numbers: [], subjects: ['Add gadget'] })
  })

  it('reads Fixes trailers with a sha but not Fixes of an issue or a plain word', () => {
    const found = parseReferences([
      'Fixes: abc1234\n',
      'fixes #9',
      'Fixed defaced',
      'Closes commit 1234567',
    ])
    expect(found.shas).toEqual(['abc1234', '1234567'])
    expect(found.numbers).toEqual([])
  })

  it('reads a sha or number only on a line that mentions regression', () => {
    const found = parseReferences([
      'Fix regression introduced in abc1234 (#7)\nunrelated #8 and def5678',
      `A regressed in ${'c'.repeat(40)} and #7 again, also decade`,
      'Regression of #11 and defaced',
    ])
    expect(found.shas).toEqual(['abc1234', 'c'.repeat(40)])
    expect(found.numbers).toEqual([7, 11])
  })

  it('finds nothing in an ordinary message', () => {
    expect(parseReferences(['Add feature (#3)\n', ''])).toEqual({
      shas: [],
      numbers: [],
      subjects: [],
    })
  })
})
