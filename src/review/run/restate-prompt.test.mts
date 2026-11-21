import { describe, expect, it } from 'vitest'

import type { Restatable } from '../context/restatable.mts'
import type { Finding } from '../finding.mts'
import { checkedCredits, restateLines, withRaisedBy } from './restate-prompt.mts'
import { REVIEW_VERIFIER_SCHEMA, buildVerifierRunPrompt, parseReviewVerifier } from './verify.mts'
import type { VerifierInput } from './verify.mts'

const ITEM: Restatable = {
  login: 'codex[bot]',
  url: 'https://example.test/c/1',
  where: 'src/a.ts:7',
  stated: 'P1 (Codex; high tier)',
  text: 'Cache is never invalidated.',
}

const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: null, hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}

describe('the other reviewers block', () => {
  it('is added to the prompt only when an item exists, as its own labelled block', () => {
    const plain = buildVerifierRunPrompt(INPUT)
    expect(buildVerifierRunPrompt({ ...INPUT, restate: [] })).toBe(plain)
    const prompt = buildVerifierRunPrompt({ ...INPUT, restate: [ITEM] })
    expect(prompt).not.toBe(plain)
    expect(prompt).toContain("## Other reviewers' open blocking and high items")
    expect(prompt).toContain('"url": "https://example.test/c/1"')
    expect(prompt.indexOf('## Other reviewers')).toBeLessThan(prompt.indexOf('untrusted data'))
  })

  it('returns no lines for undefined or empty items', () => {
    expect(restateLines(undefined)).toEqual([])
    expect(restateLines([])).toEqual([])
  })
})

describe('withRaisedBy', () => {
  const props = (schema: object) =>
    (schema as typeof REVIEW_VERIFIER_SCHEMA).properties.findings.items.properties

  it('is the same schema without items and allows raisedBy with them', () => {
    expect(withRaisedBy(REVIEW_VERIFIER_SCHEMA, undefined)).toBe(REVIEW_VERIFIER_SCHEMA)
    expect(withRaisedBy(REVIEW_VERIFIER_SCHEMA, [])).toBe(REVIEW_VERIFIER_SCHEMA)
    const schema = withRaisedBy(REVIEW_VERIFIER_SCHEMA, [ITEM])
    expect(props(schema)).toHaveProperty('raisedBy')
    expect(props(REVIEW_VERIFIER_SCHEMA)).not.toHaveProperty('raisedBy')
    expect(schema.required).toEqual(REVIEW_VERIFIER_SCHEMA.required)
    expect(schema.properties.findings.items.required).not.toContain('raisedBy')
  })
})

describe('checkedCredits', () => {
  const finding = (raisedBy?: Finding['raisedBy']): Finding => ({
    pillar: 'correctness',
    severity: 'high',
    title: 'T',
    body: 'b',
    ...(raisedBy === undefined ? {} : { raisedBy }),
  })

  it('keeps a listed link with the listed login and drops anything else', () => {
    const forged = { login: 'someone', url: 'https://evil.test/x' }
    const claimed = { login: 'renamed', url: ITEM.url }
    expect(checkedCredits([finding(claimed)], [ITEM])).toEqual([
      finding({ login: 'codex[bot]', url: ITEM.url }),
    ])
    expect(checkedCredits([finding(forged), finding()], [ITEM])).toEqual([finding(), finding()])
    expect(checkedCredits([finding(claimed)], undefined)).toEqual([finding()])
  })

  it('applies to the parsed verifier answer', () => {
    const structured = {
      summary: 's',
      pullRequestSummary: 'p',
      findings: [
        {
          pillar: 'correctness',
          severity: 'high',
          title: 'Stale cache',
          body: 'The cache is never invalidated.',
          sources: [],
          raisedBy: { login: 'x', url: ITEM.url },
        },
      ],
    }
    const run = { structured, skills: [], usage: {} } as never
    expect(parseReviewVerifier(run, 0, [], [ITEM]).findings[0]?.raisedBy).toEqual({
      login: 'codex[bot]',
      url: ITEM.url,
    })
    expect(parseReviewVerifier(run, 0).findings[0]).not.toHaveProperty('raisedBy')
  })
})
