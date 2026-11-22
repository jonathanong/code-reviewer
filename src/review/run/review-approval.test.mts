import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { parseReviewInput } from '../finding.mts'
import type { ReviewPlan } from '../plan.mts'
import { runReview, type ReviewSteps } from './review.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const PLAN: ReviewPlan = {
  upToDate: false,
  mode: 'full',
  effort: 'high',
  sinceSha: null,
  pillars: [{ pillar: 'rules', model: 'sonnet' }],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const result = (structured: unknown, cost = 0) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: cost,
    num_turns: 1,
    structured_output: structured,
  })
const CLEAN = { summary: 's', pullRequestSummary: 'p', findings: [] }

async function run(options: {
  check?: () => string
  enabled?: boolean
  plan?: ReviewPlan
  verifier?: unknown
}) {
  const out = mkdtempSync(join(tmpdir(), 'review-approval-'))
  dirs.push(out)
  const calls: string[] = []
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') {
      return result({ skills: ['jong-skills:documentation'] })
    }
    if (prompt.includes('APPROVAL CHECK prompt text')) {
      calls.push(prompt)
      return (options.check ?? (() => result({ summary: 'Holds.', findings: [] }, 0.5)))()
    }
    if (prompt.includes('VERIFIER prompt text')) return result(options.verifier ?? CLEAN, 1)
    return result({ findings: [] })
  }
  const steps = {
    claim: async () => ({ claimed: true }),
    prepare: async () => {
      mkdirSync(join(out, 'diff'), { recursive: true })
      writeFileSync(join(out, 'diff', 'INDEX.md'), '- a.ts')
      writeFileSync(join(out, 'diff.patch'), 'diff --git a/a.ts b/a.ts\n+x\n')
      writeFileSync(join(out, 'context.json'), JSON.stringify({ title: 'T' }))
      return { headSha: 'd'.repeat(40), plan: options.plan ?? PLAN }
    },
    abort: vi.fn(async () => undefined),
    preview: async () => ({ verdict: 'Comment', warnings: [], tooLong: [], reviews: [] }),
    plugins: async () => ({
      enabled: [],
      installs: [{ name: 'jong-skills', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    rulePlugins: ['jong-skills'],
    approvalCheck: options.enabled ?? true,
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, { repo: 'acme/widgets', pr: 4, out, tree: '/t', jobs: 1 })
  const json = (name: string) => JSON.parse(readFileSync(join(out, name), 'utf8'))
  return { outcome, out, calls, json, report: () => readFileSync(join(out, 'report.md'), 'utf8') }
}

describe('runReview approval check', () => {
  it('runs one more pass on an approval, keeps it, and reports that it ran and changed nothing', async () => {
    const { outcome, calls, report, json } = await run({})
    expect(calls).toHaveLength(1)
    expect(outcome.summary).toMatchObject({ verdict: 'Approve', approvalCheck: 'upheld' })
    expect(outcome.summary.costUsd).toBe(1.5)
    expect(report()).toContain('### Second check on the approval\n\nRan (opus), added 0 findings')
    expect(report()).toContain('the approval stands')
    expect(report()).toContain(', approval check $0.5000')
    expect(json('report.json').approvalCheck.outcome).toBe('upheld')
  })

  it('sees the review so far and the pillars that ran', async () => {
    const { calls } = await run({})
    expect(calls[0]).toContain('## Pillars that ran\n\nrules')
    expect(calls[0]).toContain('## The review so far')
  })

  it('merges what the check confirms and derives the verdict again', async () => {
    const high = { pillar: 'blast-radius', severity: 'high', title: 'Unread file', body: 'b' }
    const { outcome, json, report } = await run({
      check: () =>
        result({ summary: 'Found one.', reviewSummary: 'One high finding.', findings: [high] }),
    })
    expect(json('review.json').summary).toBe('One high finding.')
    expect(report()).toContain('One high finding.')
    expect(outcome.summary).toMatchObject({
      verdict: 'Comment',
      approvalCheck: 'changed',
      findings: { high: 1 },
    })
    expect(json('review.json').findings).toEqual([high])
    expect(report()).toContain('the verdict changed from Approve to Comment')
  })

  it('keeps the verifier summary when the check adds a finding but rewrites nothing', async () => {
    const high = { pillar: 'blast-radius', severity: 'high', title: 'Unread file', body: 'b' }
    const { json, report } = await run({
      check: () => result({ summary: 'Found one.', findings: [high] }),
    })
    expect(json('review.json').summary).toBe('s')
    expect(report()).toContain('### Verdict: Comment\n\ns\n')
  })

  it('completes as a Comment, with the check listed as skipped, when the pass fails', async () => {
    const { outcome, json, report } = await run({
      check: () => {
        throw new Error('timed out')
      },
    })
    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toMatchObject({ verdict: 'Comment', approvalCheck: 'failed' })
    const review = json('review.json')
    expect(review.skipped).toEqual([
      { pillar: 'approval-check', reason: expect.stringContaining('not an approval') },
    ])
    expect(parseReviewInput(review).skipped).toEqual(review.skipped)
    expect(() => parseReviewInput({ ...review, verdict: 'Approve' })).toThrow('does not match')
    expect(report()).toContain('Did not complete (timed out)')
    expect(report()).toContain('- approval-check: The second check')
  })

  it('does not run when switched off, for a light review, or for a verdict that is not Approve', async () => {
    const light = { ...PLAN, mode: 'light' as const }
    const high = {
      ...CLEAN,
      findings: [{ pillar: 'rules', severity: 'high', title: 't', body: 'b', sources: [] }],
    }
    for (const options of [{ enabled: false }, { plan: light }, { verifier: high }]) {
      const { calls, outcome } = await run(options)
      expect(calls).toHaveLength(0)
      expect(outcome.summary).not.toHaveProperty('approvalCheck')
    }
  })
})
