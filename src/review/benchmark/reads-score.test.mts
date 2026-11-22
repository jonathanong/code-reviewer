import { describe, expect, it } from 'vitest'

import { parseEvalCases } from './cases.mts'
import { expectedReadsFor, readNotes, scoreReads } from './reads-score.mts'

const base = {
  repo: 'acme/widgets',
  pr: 1,
  title: 't',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
}
const [positive, negative, plain] = parseEvalCases([
  {
    ...base,
    id: 'p',
    kind: 'positive',
    expected: [{ pillar: 'rules', severity: 'high', path: null, lines: null, claim: 'c' }],
    expectedReads: ['a.ts', 'b.ts'],
  },
  { ...base, id: 'n', kind: 'negative', expected: [], expectedReads: ['a.ts'] },
  { ...base, id: 'plain', kind: 'negative', expected: [] },
])
if (positive === undefined || negative === undefined || plain === undefined)
  throw new Error('setup')

describe('expectedReadsFor', () => {
  it('applies to the expected pillars of a positive and to every pillar of a negative', () => {
    expect(expectedReadsFor(positive, 'rules')).toEqual(['a.ts', 'b.ts'])
    expect(expectedReadsFor(positive, 'security')).toEqual([])
    expect(expectedReadsFor(negative, 'security')).toEqual(['a.ts'])
    expect(expectedReadsFor(plain, 'rules')).toEqual([])
  })
})

describe('scoreReads', () => {
  it('counts the expected reads the run opened', () => {
    expect(scoreReads(positive, ['a.ts', 'b.ts'], { reads: ['b.ts', 'c.ts'] })).toEqual({
      id: 'p',
      expectedReads: ['a.ts', 'b.ts'],
      opened: 1,
      missing: ['a.ts'],
    })
    expect(scoreReads(positive, ['a.ts'], { reads: [] }).opened).toBe(0)
  })

  it('has no count without recorded reads or from another harness', () => {
    expect(scoreReads(positive, ['a.ts'], {}).opened).toBeNull()
    expect(scoreReads(positive, ['a.ts'], { reads: [], harness: 'codex' }).opened).toBeNull()
  })
})

describe('readNotes', () => {
  it('lists a line per case, with what was not opened', () => {
    const done = scoreReads(positive, ['a.ts', 'b.ts'], { reads: ['a.ts', 'b.ts'] })
    const part = scoreReads(positive, ['a.ts', 'b.ts'], { reads: ['a.ts'] })
    expect(readNotes([{ pillar: 'rules', readCases: [done, part] }])).toEqual([
      '- rules p: opened 2 of 2 expected reads',
      '- rules p: opened 1 of 2 expected reads; not opened: b.ts',
    ])
  })
})
