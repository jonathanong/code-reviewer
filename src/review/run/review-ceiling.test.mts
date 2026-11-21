import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { DEFAULT_MODEL_PLAN } from '../models.mts'
import type { ReviewPlan } from '../plan.mts'
import { createStepWatch } from '../step-watch.mts'
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
  pillars: [
    { pillar: 'rules', model: 'sonnet' },
    { pillar: 'correctness', model: 'sonnet' },
    { pillar: 'security', model: 'sonnet' },
  ],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const result = (structured: unknown, cost: number) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: cost,
    num_turns: 1,
    structured_output: structured,
  })
const CLEAN = { summary: 's', pullRequestSummary: 'p', findings: [] }

async function run(options: { ceilingUsd?: number; check?: boolean; evidence?: boolean }) {
  const out = mkdtempSync(join(tmpdir(), 'review-ceiling-'))
  dirs.push(out)
  const lines: string[] = []
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '')
      return result({ skills: ['jong-skills:documentation'] }, 0.01)
    if (prompt.includes('APPROVAL CHECK prompt text'))
      return result({ summary: 'Holds.', findings: [] }, 0.5)
    if (prompt.includes('VERIFIER prompt text')) return result(CLEAN, 1)
    if (prompt.includes('EVIDENCE prompt text'))
      return result({ sources: [], findings: [], claims: [] }, 0.5)
    return result({ findings: [] }, 0.1)
  }
  const watch = createStepWatch({
    write: (line) => void lines.push(line),
    now: () => 0,
    ...(options.ceilingUsd === undefined ? {} : { ceilingUsd: options.ceilingUsd }),
  })
  const source = {
    name: 'aws',
    description: 'Logs.',
    guide: { file: '/g.md' },
    commands: [],
    env: {},
  }
  const steps = {
    claim: async () => ({ claimed: true }),
    prepare: async () => {
      mkdirSync(join(out, 'diff'), { recursive: true })
      writeFileSync(join(out, 'diff', 'INDEX.md'), '- a.ts')
      writeFileSync(join(out, 'diff.patch'), 'diff --git a/a.ts b/a.ts\n+x\n')
      writeFileSync(join(out, 'context.json'), JSON.stringify({ title: 'T' }))
      return { headSha: 'd'.repeat(40), plan: PLAN }
    },
    abort: vi.fn(async () => undefined),
    preview: async () => ({ verdict: 'Comment', warnings: [], tooLong: [], reviews: [] }),
    plugins: async () => ({
      enabled: [],
      installs: [{ name: 'jong-skills', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({
      sources: options.evidence === true ? [source] : [],
      readGuide: async () => 'guide',
    }),
    rulePlugins: ['jong-skills'],
    approvalCheck: options.check ?? true,
    models: { plan: DEFAULT_MODEL_PLAN, watch },
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, { repo: 'acme/widgets', pr: 4, out, tree: '/t', jobs: 1 })
  const json = (name: string) => JSON.parse(readFileSync(join(out, name), 'utf8'))
  return { outcome, lines, json }
}

describe('runReview cost ceiling', () => {
  it('approves with no ceiling, however much the steps cost', async () => {
    const { outcome } = await run({})
    expect(outcome.summary).toMatchObject({ verdict: 'Approve', approvalCheck: 'upheld' })
  })

  it('approves when the ceiling is never reached', async () => {
    const { outcome, lines } = await run({ ceilingUsd: 100 })
    expect(outcome.summary).toMatchObject({ verdict: 'Approve' })
    expect(lines.some((line) => line.includes('skipped'))).toBe(false)
  })

  it('skips the steps after the one that reaches it and never approves', async () => {
    // select 0.01 + three pillars 0.1 each + verifier 1 = 1.31 before the check, which is skipped.
    const { outcome, json } = await run({ ceilingUsd: 1.2 })
    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toMatchObject({ verdict: 'Comment', approvalCheck: 'failed' })
    expect(json('review.json').skipped).toEqual([
      {
        pillar: 'approval-check',
        reason: expect.stringContaining('cost ceiling reached ($1.31 of $1.20)'),
      },
    ])
  })

  it('never approves a review whose evidence step was skipped, even with the check switched off', async () => {
    const { outcome, json, lines } = await run({ ceilingUsd: 1.2, check: false, evidence: true })
    expect(outcome.summary).toMatchObject({ verdict: 'Comment' })
    expect(json('review.json').skipped).toEqual([
      {
        pillar: 'approval-check',
        reason: expect.stringContaining('cost ceiling reached ($1.31 of $1.20)'),
      },
    ])
    expect(json('evidence.json').error).toContain('cost ceiling reached')
    expect(
      lines.filter((line) => line.includes('evidence') && line.includes('skipped')),
    ).toHaveLength(2)
  })

  it('fails a review whose pillars reach it before the verifier, with pillars left unrun', async () => {
    const { outcome, json, lines } = await run({ ceilingUsd: 0.12 })
    expect(outcome.ok).toBe(false)
    expect(outcome.summary.error).toContain('cost ceiling reached ($0.21 of $0.12)')
    expect(json('pillars/security.json').error).toContain('cost ceiling reached')
    expect(
      lines.filter((line) => line.includes('pillar.security') && line.includes('skipped')),
    ).toHaveLength(2)
  })
})
