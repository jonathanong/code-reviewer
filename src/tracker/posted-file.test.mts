import { describe, expect, it, vi } from 'vitest'

import { savePostedFindings } from './posted-file.mts'

const SHA = 'a'.repeat(40)
const findings = [
  {
    pillar: 'correctness' as const,
    severity: 'high' as const,
    title: 'One',
    body: 'b',
    path: 'a.ts',
  },
  { pillar: 'design' as const, severity: 'low' as const, title: 'Two', body: 'b' },
]

describe('savePostedFindings', () => {
  it('writes posted.json beside the input with one entry per finding', () => {
    const write = vi.fn()
    const result = savePostedFindings(write, '/run/review.json', SHA, findings, ['inline', 'body'])
    expect(result).toEqual({})
    expect(write).toHaveBeenCalledOnce()
    const [path, text] = write.mock.calls[0] as [string, string]
    expect(path).toBe('/run/posted.json')
    expect(JSON.parse(text)).toEqual({
      version: 1,
      headSha: SHA,
      findings: [
        { id: 'F1', title: 'One', path: 'a.ts', placement: 'inline' },
        { id: 'F2', title: 'Two', path: null, placement: 'body' },
      ],
    })
  })

  it('keeps ids at review.json positions and skips a pre-existing finding', () => {
    const write = vi.fn()
    const skipped = [{ ...findings[0]!, title: 'Old', preExisting: true as const }, ...findings]
    savePostedFindings(write, '/run/review.json', SHA, skipped, ['inline', 'body'])
    const saved = JSON.parse((write.mock.calls[0] as [string, string])[1])
    expect(saved.findings).toEqual([
      { id: 'F2', title: 'One', path: 'a.ts', placement: 'inline' },
      { id: 'F3', title: 'Two', path: null, placement: 'body' },
    ])
  })

  it('reports a write failure instead of throwing', () => {
    const write = vi.fn(() => {
      throw new Error('read-only')
    })
    expect(savePostedFindings(write, '/run/review.json', SHA, [], []).trackerProblem).toContain(
      'read-only',
    )
    const text = vi.fn(() => {
      throw 'nope'
    })
    expect(savePostedFindings(text, '/run/review.json', SHA, [], []).trackerProblem).toContain(
      'nope',
    )
  })
})
