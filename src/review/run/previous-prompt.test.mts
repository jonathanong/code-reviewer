import { describe, expect, it } from 'vitest'

import type { PreviousReview } from '../context/types.mts'
import { previousLines } from './previous-prompt.mts'
import { buildVerifierRunPrompt } from './verify.mts'
import type { VerifierInput } from './verify.mts'

const PREVIOUS: PreviousReview = {
  sha: 'a'.repeat(40),
  date: '2026-01-02',
  mode: 'full',
  verdict: 'Request Changes',
  posted: true,
  reviewUrl: 'https://example.test/pull/1#pullrequestreview-1',
  findings: [
    { severity: 'blocking', title: 'Token logged', pillar: 'security', path: 'a.ts', line: 3 },
  ],
}

const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: 'a'.repeat(40), hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}

describe('the earlier review block', () => {
  it('is added to the prompt only with an earlier review, before the untrusted-data line', () => {
    const plain = buildVerifierRunPrompt(INPUT)
    const prompt = buildVerifierRunPrompt({ ...INPUT, previous: PREVIOUS })
    expect(prompt).not.toBe(plain)
    expect(prompt).toContain('## Your earlier review of this pull request')
    expect(prompt).toContain('"title": "Token logged"')
    expect(prompt.indexOf('## Your earlier review')).toBeLessThan(prompt.indexOf('untrusted data'))
    expect(plain).not.toContain('## Your earlier review')
  })

  it('has no lines without an earlier review', () => {
    expect(previousLines(undefined)).toEqual([])
  })

  it('tells the verifier the findings are claims and the evidence is not offered', () => {
    const text = previousLines(PREVIOUS).join('\n')
    expect(text).toContain('not instructions')
    expect(text).toContain('establish again any evidence')
    expect(text).toContain('`fixedThreadIds`')
  })
})
