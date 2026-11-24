import { describe, expect, it, vi } from 'vitest'

import { parseUsage } from '../../harness/claude-usage.mts'
import type { ReviewInput } from '../finding.mts'
import { postFinalReview } from '../post.mts'
import type { ReviewIo } from '../github.mts'
import { buildReport } from './report.mts'
import { renderReport } from './report-render.mts'
import { buildReviewInput } from './review-input.mts'
import { runReviewVerifier } from './verify-run.mts'
import type { ReviewVerifierOutput, VerifierInput } from './verify.mts'

const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: null, hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}
const IMPACT = { kind: 'breaking', basis: 'removes the `--foo` CLI flag' }
const answer = JSON.stringify({
  type: 'result',
  structured_output: { summary: 's', pullRequestSummary: 'p', findings: [], impact: IMPACT },
})

describe('which verifier runs ask for the impact', () => {
  const run = async (mode: 'full' | 'light') => {
    const exec = vi.fn(async () => answer)
    const output = await runReviewVerifier(INPUT, { model: 'opus', mode, tree: '/t', exec })
    const args = (exec.mock.calls[0] as unknown as [string, string[]])[1]
    return { output, args }
  }

  it('asks a full review and keeps the answer', async () => {
    const { output, args } = await run('full')
    expect(args[1]).toContain('## Impact of the change')
    expect(args[args.indexOf('--json-schema') + 1]).toContain('"impact"')
    expect(output.impact).toEqual(IMPACT)
  })

  it('does not ask a light review, and ignores an impact it gave anyway', async () => {
    const { output, args } = await run('light')
    expect(args[1]).not.toContain('Impact of the change')
    expect(args[args.indexOf('--json-schema') + 1]).not.toContain('"impact"')
    expect(output).not.toHaveProperty('impact')
  })
})

describe('the impact in review.json and report.md', () => {
  const usage = parseUsage({ total_cost_usd: 0, num_turns: 1 })
  const output = (impact?: object): ReviewVerifierOutput => ({
    summary: 's',
    pullRequestSummary: 'p',
    findings: [],
    questions: [],
    sources: [],
    dropped: new Map(),
    fixedThreadIds: [],
    dependencies: [],
    ...(impact === undefined ? {} : { impact: impact as never }),
    skills: [],
    usage,
  })
  const report = (out: ReviewVerifierOutput) =>
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
      verifier: { model: 'opus', output: out },
    })

  it('carries from the verifier to the review input', () => {
    const parts = { effort: 'high', skipped: [], findings: [], questions: [], dependencies: [] }
    const run = { out: '/run', sinceSha: null, hasRules: false }
    const build = (out: ReviewVerifierOutput) =>
      buildReviewInput({ ...parts, effort: 'high', output: out, run })
    expect(build(output(IMPACT)).impact).toEqual(IMPACT)
    expect(build(output())).not.toHaveProperty('impact')
  })

  it('is shown in the report with its basis, and not without one', () => {
    expect(renderReport(report(output(IMPACT)))).toContain(
      '### Impact: breaking\n\nremoves the `--foo` CLI flag',
    )
    expect(renderReport(report(output({ kind: 'unsure' })))).toContain('### Impact: unsure\n\n###')
    expect(renderReport(report(output()))).not.toContain('### Impact')
  })
})

describe('the scope of a posted review comes from the pull request files', () => {
  const SHA = 'c'.repeat(40)
  const io = (filenames: string[]) =>
    ({
      headSha: vi.fn(async () => SHA),
      listFiles: vi.fn(async () => filenames.map((filename) => ({ filename }))),
      pullAuthor: vi.fn(async () => 'dev'),
      trustedAuthors: vi.fn(async () => new Set<string>()),
      standingReviews: vi.fn(async () => []),
    }) as unknown as ReviewIo
  const input: ReviewInput = {
    effort: 'high',
    summary: '',
    skipped: [],
    findings: [],
    questions: [],
  }

  it('prints test-only for a pull request of test files, with no input field', async () => {
    const outcome = await postFinalReview(
      io(['src/a.test.mts', 'tests/b.mts']),
      { ...input },
      SHA,
      {
        dryRun: true,
      },
    )
    expect(outcome.reviews[0]?.body).toContain('\n\n**Class:** test-only')
  })

  it('lists the kinds, with the impact, for a mixed pull request', async () => {
    const outcome = await postFinalReview(
      io(['src/a.mts', 'src/a.test.mts']),
      { ...input, impact: { kind: 'maintenance' } },
      SHA,
      { dryRun: true },
    )
    expect(outcome.reviews[0]?.body).toContain('**Class:** maintenance · source, tests')
  })

  it('prints no line for a pull request with no files and no impact', async () => {
    const outcome = await postFinalReview(io([]), { ...input }, SHA, { dryRun: true })
    expect(outcome.reviews[0]?.body).not.toContain('Class')
  })
})
