import { describe, expect, it } from 'vitest'

import { parseEvalCases } from './cases.mts'

const negative = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1',
  repo: 'acme/widgets',
  pr: 3,
  title: 'Title',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  expected: [],
  ...overrides,
})

describe('expectedReads', () => {
  it('parses a list of file paths and leaves it off when absent', () => {
    const [withReads, without] = parseEvalCases([
      negative({ expectedReads: ['src/a.ts'] }),
      negative({ id: 'n2' }),
    ])
    expect(withReads?.expectedReads).toEqual(['src/a.ts'])
    expect(without).not.toHaveProperty('expectedReads')
  })

  it('rejects a value that is not a non-empty array of non-empty strings', () => {
    for (const bad of ['a.ts', [], [''], [3], ['a.ts', null]]) {
      expect(() => parseEvalCases([negative({ expectedReads: bad })])).toThrow(
        'expectedReads must be a non-empty array of file paths',
      )
    }
  })
})
