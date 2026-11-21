import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseUsage } from '../../harness/claude-usage.mts'
import type { SplitSummary } from '../context/change-shape/split.mts'
import { checkPostedText, SPLIT_TARGET } from '../concise.mts'
import { parseReviewInput, type Finding, type ReviewInput } from '../finding.mts'
import { renderHeader } from '../render.mts'
import { buildReport } from './report.mts'
import { rerenderReport, writeReportFiles } from './report-file.mts'
import { renderReport } from './report-render.mts'
import { checkedSplitProposal, splitLines, withSplitProposal } from './split-prompt.mts'
import { REVIEW_VERIFIER_SCHEMA, buildVerifierRunPrompt, parseReviewVerifier } from './verify.mts'
import type { VerifierInput } from './verify.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const SPLIT: SplitSummary = {
  files: 49,
  lines: 362,
  mechanical: {
    lines: 160,
    files: 40,
    parts: [{ what: 'the same edit repeated', files: 40, lines: 160 }],
  },
  explainedBy: ['.oxlintrc.json: rules.prefer-const'],
  remainder: { lines: 202 },
}
const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: null, hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}
const PROPOSAL =
  'Move the 40 files changed only by enabling `prefer-const` and its autofix into their own pull request; keep the lib/ changes here.'
const HEAD = 'a'.repeat(40)
const HIGH: Finding = { pillar: 'correctness', severity: 'high', title: 'Bug', body: 'b' }

describe('the large change block', () => {
  it('is added only with a summary, before the untrusted-data line, and carries the measurement', () => {
    const plain = buildVerifierRunPrompt(INPUT)
    expect(buildVerifierRunPrompt({ ...INPUT })).toBe(plain)
    const prompt = buildVerifierRunPrompt({ ...INPUT, split: SPLIT })
    expect(prompt).toContain('## Large change with a mechanical part')
    expect(prompt).toContain('`splitProposal`')
    expect(prompt).toContain('"explainedBy"')
    expect(prompt).toContain('never raise a finding about the size of the change')
    expect(prompt.indexOf('## Large change')).toBeLessThan(prompt.indexOf('untrusted data'))
    expect(splitLines(undefined)).toEqual([])
  })
})

describe('withSplitProposal', () => {
  it('is the same schema object without a summary, and an optional string field with one', () => {
    expect(withSplitProposal(REVIEW_VERIFIER_SCHEMA, undefined)).toBe(REVIEW_VERIFIER_SCHEMA)
    const schema = withSplitProposal(REVIEW_VERIFIER_SCHEMA, SPLIT)
    expect(schema.properties).toHaveProperty('splitProposal', { type: 'string' })
    expect(REVIEW_VERIFIER_SCHEMA.properties).not.toHaveProperty('splitProposal')
    expect(schema.required).toEqual(REVIEW_VERIFIER_SCHEMA.required)
  })
})

describe('checkedSplitProposal and parseReviewVerifier', () => {
  const run = (extra: object) =>
    ({ structured: { summary: 's', findings: [], ...extra }, skills: [], usage: {} }) as never

  it('collapses whitespace, and drops a blank, a non-string, or an unsolicited proposal', () => {
    expect(checkedSplitProposal(' a\n  b ', SPLIT)).toBe('a b')
    expect(checkedSplitProposal('  ', SPLIT)).toBeUndefined()
    expect(checkedSplitProposal(3, SPLIT)).toBeUndefined()
    expect(checkedSplitProposal(PROPOSAL, undefined)).toBeUndefined()
  })

  it('keeps the proposal only when a summary was given', () => {
    const given = run({ splitProposal: PROPOSAL })
    expect(parseReviewVerifier(given, 0, [], [], [], SPLIT).splitProposal).toBe(PROPOSAL)
    expect(parseReviewVerifier(given, 0)).not.toHaveProperty('splitProposal')
  })
})

const PLAIN: ReviewInput = {
  effort: 'high',
  summary: 'S',
  skipped: [],
  findings: [],
  questions: [],
}
const REVIEW: ReviewInput = { ...PLAIN, splitProposal: PROPOSAL }

describe('the review body', () => {
  it('shows the proposal near the top, not collapsed, and nothing without one', () => {
    const body = renderHeader(REVIEW, HEAD)
    const line = `**Consider splitting this up:** ${PROPOSAL}`
    expect(body).toContain(line)
    expect(body.indexOf(line)).toBeGreaterThan(body.indexOf('\n\nS'))
    expect(body.slice(0, body.indexOf(line))).not.toContain('<details')
    expect(body).not.toContain('<details')
    expect(renderHeader(PLAIN, HEAD)).not.toContain('splitting')
  })

  it('does not change the verdict or the findings it shows', () => {
    const withFinding = { ...PLAIN, findings: [HIGH] }
    const verdict = (input: ReviewInput) =>
      /\[([^\]]+)\] Code review/u.exec(renderHeader(input, HEAD))
    expect(verdict({ ...withFinding, splitProposal: PROPOSAL })?.[1]).toBe(
      verdict(withFinding)?.[1],
    )
    expect(verdict(REVIEW)?.[1]).toBe(verdict(PLAIN)?.[1])
  })

  it('survives review.json: kept, whitespace collapsed, and rejected when not a string', () => {
    expect(parseReviewInput(JSON.parse(JSON.stringify(REVIEW))).splitProposal).toBe(PROPOSAL)
    expect(parseReviewInput({ ...REVIEW, splitProposal: ' a\n b ' }).splitProposal).toBe('a b')
    expect(parseReviewInput({ ...REVIEW, splitProposal: ' ' })).not.toHaveProperty('splitProposal')
    expect(parseReviewInput(PLAIN)).not.toHaveProperty('splitProposal')
    expect(() => parseReviewInput({ ...REVIEW, splitProposal: 4 })).toThrow('string')
  })

  it('warns when the proposal is over its length target, and not at the target', () => {
    const at = { ...PLAIN, splitProposal: 'x'.repeat(SPLIT_TARGET) }
    const over = { ...PLAIN, splitProposal: 'x'.repeat(SPLIT_TARGET + 1) }
    expect(checkPostedText(at, []).warnings).toEqual([])
    expect(checkPostedText(over, []).warnings).toEqual([
      `splitProposal is ${SPLIT_TARGET + 1} characters, over its ${SPLIT_TARGET} target`,
    ])
  })
})

describe('report.md', () => {
  const usage = parseUsage({ total_cost_usd: 0, num_turns: 1 })
  const input = (proposal?: string) =>
    buildReport({
      repo: 'acme/widgets',
      pr: 4,
      title: 'Lint',
      headSha: 'b'.repeat(40),
      mode: 'full',
      effort: 'high',
      reasons: [],
      verdict: 'Approve',
      skipped: [],
      skillSelection: { selected: [], available: 0, usage },
      pillars: [],
      verifier: {
        model: 'opus',
        output: {
          summary: 's',
          pullRequestSummary: 'p',
          findings: [],
          sources: [],
          dropped: new Map(),
          questions: [],
          fixedThreadIds: [],
          dependencies: [],
          ...(proposal === undefined ? {} : { splitProposal: proposal }),
          skills: [],
          usage,
        },
      },
    })

  it('shows the proposal, and nothing without one', () => {
    expect(renderReport(input(PROPOSAL))).toContain(`### Proposed split\n\n${PROPOSAL}`)
    expect(renderReport(input())).not.toContain('Proposed split')
  })

  it('round-trips through report.json', () => {
    const out = mkdtempSync(join(tmpdir(), 'split-report-'))
    dirs.push(out)
    const path = writeReportFiles(out, input(PROPOSAL))
    const written = readFileSync(path, 'utf8')
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).splitProposal).toBe(PROPOSAL)
    expect(rerenderReport(out)).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(written)
    expect(written).toContain(PROPOSAL)
  })
})
