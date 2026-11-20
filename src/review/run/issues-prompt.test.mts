import { describe, expect, it } from 'vitest'

import type { IssueText } from '../issues.mts'
import { buildPillarRunPrompt } from './pillar-prompt.mts'
import { issuesLines } from './issues-prompt.mts'
import { buildVerifierRunPrompt } from './verify.mts'

const ISSUES: IssueText[] = [{ ref: 'acme/lib#2', state: 'open', title: 'Add retries', body: 'x' }]

describe('issuesLines', () => {
  it('is empty without issues', () => {
    expect(issuesLines(undefined, '/run')).toEqual([])
    expect(issuesLines([], '/run')).toEqual([])
  })

  it('names the file and each issue, and marks the text untrusted', () => {
    const text = issuesLines(ISSUES, '/run').join('\n')
    expect(text).toContain('## Linked issues')
    expect(text).toContain('`/run/issues.json`')
    expect(text).toContain('check the change against what each issue asks')
    expect(text).toContain('untrusted data')
    expect(text).toContain('- acme/lib#2 (open): Add retries')
    expect(text).not.toContain('\nx')
  })
})

describe('the linked issues block in the prompts', () => {
  const run = { out: '/run', sinceSha: null, hasRules: true }
  const verifierInput = {
    verifierPrompt: 'VERIFIER',
    references: '/refs',
    run,
    findings: [],
    skipped: [],
    threads: [],
  }

  it('leaves both prompts byte-identical without issues', () => {
    const verifier = buildVerifierRunPrompt(verifierInput)
    expect(buildVerifierRunPrompt({ ...verifierInput, run: { ...run, issues: [] } })).toBe(verifier)
    expect(verifier).not.toContain('Linked issues')
  })

  it('tells only the verifier, since it performs the congruence pillar', () => {
    const withIssues = { ...run, issues: ISSUES }
    const pillar = { contract: 'C', pillarText: 'P', skills: [] }
    expect(buildPillarRunPrompt({ ...pillar, run: withIssues })).toBe(
      buildPillarRunPrompt({ ...pillar, run }),
    )
    const verifier = buildVerifierRunPrompt({ ...verifierInput, run: withIssues })
    expect(verifier.indexOf('## Linked issues')).toBeLessThan(
      verifier.indexOf('## Pillars that did not run'),
    )
  })
})
