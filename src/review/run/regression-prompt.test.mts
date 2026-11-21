import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseUsage } from '../../harness/claude-usage.mts'
import type { LinkedCommit } from '../context/types.mts'
import { parseReviewInput, type ReviewInput } from '../finding.mts'
import { renderHeader } from '../render.mts'
import {
  checkedRegressionPrevent,
  regressionLines,
  withRegressionPrevent,
} from './regression-prompt.mts'
import { buildReport } from './report.mts'
import { rerenderReport, writeReportFiles } from './report-file.mts'
import { renderReport } from './report-render.mts'
import { REVIEW_VERIFIER_SCHEMA, buildVerifierRunPrompt, parseReviewVerifier } from './verify.mts'
import type { VerifierInput } from './verify.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const COMMIT: LinkedCommit = {
  sha: 'a'.repeat(40),
  subject: 'Add cache',
  how: 'revert',
  files: ['src/cache.ts'],
}
const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: null, hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}
const ADVICE = 'Code MUST NOT drop a cache key part without a test pinning the key.'

describe('the linked commits block', () => {
  it('is added only when a commit was found, and lists it', () => {
    const plain = buildVerifierRunPrompt(INPUT)
    expect(buildVerifierRunPrompt({ ...INPUT, regression: [] })).toBe(plain)
    const prompt = buildVerifierRunPrompt({ ...INPUT, regression: [COMMIT] })
    expect(prompt).toContain('## Commits this change says it fixes or reverts')
    expect(prompt).toContain('`regressionPrevent`')
    expect(prompt).toContain(`"sha": "${COMMIT.sha}"`)
    expect(prompt.indexOf('## Commits this')).toBeLessThan(prompt.indexOf('untrusted data'))
  })

  it('returns no lines for undefined or empty commits', () => {
    expect(regressionLines(undefined)).toEqual([])
    expect(regressionLines([])).toEqual([])
  })
})

describe('withRegressionPrevent', () => {
  it('is the same schema object without commits, and an optional string field with them', () => {
    expect(withRegressionPrevent(REVIEW_VERIFIER_SCHEMA, undefined)).toBe(REVIEW_VERIFIER_SCHEMA)
    expect(withRegressionPrevent(REVIEW_VERIFIER_SCHEMA, [])).toBe(REVIEW_VERIFIER_SCHEMA)
    const schema = withRegressionPrevent(REVIEW_VERIFIER_SCHEMA, [COMMIT])
    expect(schema.properties).toHaveProperty('regressionPrevent', { type: 'string' })
    expect(REVIEW_VERIFIER_SCHEMA.properties).not.toHaveProperty('regressionPrevent')
    expect(schema.required).toEqual(REVIEW_VERIFIER_SCHEMA.required)
  })
})

describe('checkedRegressionPrevent', () => {
  it('collapses whitespace and drops a blank, a non-string, or an unrequested note', () => {
    expect(checkedRegressionPrevent(' a\n  b ', [COMMIT])).toBe('a b')
    expect(checkedRegressionPrevent('  ', [COMMIT])).toBeUndefined()
    expect(checkedRegressionPrevent(3, [COMMIT])).toBeUndefined()
    expect(checkedRegressionPrevent(ADVICE, [])).toBeUndefined()
    expect(checkedRegressionPrevent(ADVICE, undefined)).toBeUndefined()
  })
})

describe('parseReviewVerifier', () => {
  const run = (extra: object) =>
    ({ structured: { summary: 's', findings: [], ...extra }, skills: [], usage: {} }) as never

  it('keeps the recommendation when commits were listed and drops it when none were', () => {
    const given = run({ regressionPrevent: ADVICE })
    expect(parseReviewVerifier(given, 0, [], [], [COMMIT]).regressionPrevent).toBe(ADVICE)
    expect(parseReviewVerifier(given, 0)).not.toHaveProperty('regressionPrevent')
  })
})

const PLAIN: ReviewInput = { effort: 'high', summary: '', skipped: [], findings: [], questions: [] }
const REVIEW: ReviewInput = { ...PLAIN, regressionPrevent: ADVICE }

describe('the review body', () => {
  it('shows the recommendation collapsed under a one-line summary, and nothing without one', () => {
    const body = renderHeader(REVIEW, 'a'.repeat(40))
    expect(body).toContain(
      `<details><summary>Preventing this regression</summary>\n\n${ADVICE}\n\n</details>`,
    )
    expect(renderHeader(PLAIN, 'a'.repeat(40))).not.toContain('Preventing this regression')
  })

  it('survives review.json: kept, whitespace collapsed, and rejected when not a string', () => {
    expect(parseReviewInput(JSON.parse(JSON.stringify(REVIEW))).regressionPrevent).toBe(ADVICE)
    expect(parseReviewInput({ ...REVIEW, regressionPrevent: ' a\n b ' }).regressionPrevent).toBe(
      'a b',
    )
    expect(parseReviewInput({ ...REVIEW, regressionPrevent: ' ' })).not.toHaveProperty(
      'regressionPrevent',
    )
    expect(parseReviewInput(PLAIN)).not.toHaveProperty('regressionPrevent')
    expect(() => parseReviewInput({ ...REVIEW, regressionPrevent: 4 })).toThrow('string')
  })
})

describe('report.md', () => {
  const usage = parseUsage({ total_cost_usd: 0, num_turns: 1 })
  const input = (regression: readonly LinkedCommit[] | undefined, prevent?: string) =>
    buildReport({
      repo: 'acme/widgets',
      pr: 4,
      title: 'Fix cache',
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
          ...(prevent === undefined ? {} : { regressionPrevent: prevent }),
          skills: [],
          usage,
        },
      },
      regression,
    })

  it('lists the commits and shows the recommendation collapsed', () => {
    const text = renderReport(input([COMMIT], ADVICE))
    expect(text).toContain('### Regression this change says it fixes')
    expect(text).toContain('- `aaaaaaa` Add cache (revert)')
    expect(text).toContain(`<summary>Preventing this regression</summary>\n\n${ADVICE}`)
  })

  it('lists the commits without a recommendation, and nothing without commits', () => {
    const text = renderReport(input([COMMIT]))
    expect(text).toContain('Add cache (revert)')
    expect(text).not.toContain('Preventing this regression')
    for (const none of [undefined, []]) {
      expect(renderReport(input(none, ADVICE))).not.toContain('Regression this change')
    }
  })

  it('round-trips through report.json', () => {
    const out = mkdtempSync(join(tmpdir(), 'regression-report-'))
    dirs.push(out)
    const path = writeReportFiles(out, input([COMMIT], ADVICE))
    const written = readFileSync(path, 'utf8')
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).regression).toEqual({
      commits: [COMMIT],
      prevent: ADVICE,
    })
    expect(rerenderReport(out)).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(written)
    expect(written).toContain(ADVICE)
  })
})
