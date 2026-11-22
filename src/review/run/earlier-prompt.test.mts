import { describe, expect, it } from 'vitest'

import { QUESTION } from '../earlier-fake-io.mts'
import { earlierLines, type EarlierBlock } from './previous-prompt.mts'
import { buildVerifierRunPrompt, type VerifierInput } from './verify.mts'

const BLOCK: EarlierBlock = {
  sha: 'b'.repeat(40),
  verdict: 'Request Changes',
  first: 3,
  count: 2,
  questions: [QUESTION],
  held: [],
}

const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: null, hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}

describe('the block for a review that was never posted', () => {
  it('names the commit, where its findings start, and tells the verifier to return the whole review', () => {
    const text = earlierLines(BLOCK).join('\n')
    expect(text).toContain(`\`${BLOCK.sha}\``)
    expect(text).toContain('The 2 input findings from index 3 on')
    expect(text).toContain('whole review of the head')
    expect(text).toContain(QUESTION.question)
    expect(text).not.toContain('Evidence from your earlier review')
  })

  it('offers evidence that still applies', () => {
    const held = [{ source: 'logs', commit: BLOCK.sha, status: 'checked', result: 'ok' }]
    const text = earlierLines({ ...BLOCK, held }).join('\n')
    expect(text).toContain('## Evidence from your earlier review that still applies')
    expect(text).toContain('"source": "logs"')
  })

  it('says nothing when there is nothing to carry, or no earlier review', () => {
    expect(earlierLines(undefined)).toEqual([])
    expect(earlierLines({ ...BLOCK, count: 0, questions: [] })).toEqual([])
  })

  it('still speaks for questions alone, and reads a missing verdict as none', () => {
    const text = earlierLines({ ...BLOCK, count: 0, verdict: null }).join('\n')
    expect(text).toContain('verdict none')
    expect(text).toContain(QUESTION.question)
  })

  it('is in the verifier prompt only with an earlier review, after the other earlier-review blocks', () => {
    const plain = buildVerifierRunPrompt(INPUT)
    const prompt = buildVerifierRunPrompt({ ...INPUT, earlier: BLOCK })
    expect(plain).not.toContain('never posted')
    expect(prompt).toContain('## Your earlier review of this pull request, never posted')
    expect(prompt.indexOf('never posted')).toBeLessThan(prompt.indexOf('untrusted data'))
  })
})
