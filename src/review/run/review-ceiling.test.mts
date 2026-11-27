import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
  const prompts: string[] = []
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    prompts.push(prompt)
    if (args[args.indexOf('--tools') + 1] === '')
      return result({ skills: ['ratchet-workflows:documentation'] }, 0.01)
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
      installs: [{ name: 'ratchet-workflows', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({
      sources: options.evidence === true ? [source] : [],
      readGuide: async () => 'guide',
    }),
    rulePlugins: ['ratchet-workflows'],
    approvalCheck: options.check ?? true,
    models: { plan: DEFAULT_MODEL_PLAN, watch },
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, { repo: 'acme/widgets', pr: 4, out, tree: '/t', jobs: 1 })
  const json = (name: string) => JSON.parse(readFileSync(join(out, name), 'utf8'))
  const exists = (name: string) => existsSync(join(out, name))
  return { outcome, lines, json, exists, prompts }
}

describe('runReview cost ceiling', () => {
  it('approves with no ceiling, however much the steps cost', async () => {
    const { outcome } = await run({})
    expect(outcome.summary).toMatchObject({ verdict: 'Approve', approvalCheck: 'upheld' })
  })

  it('approves when the ceiling is never reached', async () => {
    const { outcome, lines } = await run({ ceilingUsd: 100 })
    expect(outcome.summary).toMatchObject({ verdict: 'Approve' })
    expect(lines.some((line) => line.includes('not started'))).toBe(false)
  })

  it('stops whole when the ceiling keeps the second check from starting', async () => {
    // select 0.01 + three pillars 0.1 each + verifier 1 = 1.31 before the check.
    const { outcome, exists, lines } = await run({ ceilingUsd: 1.2 })
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toMatchObject({
      claimed: true,
      costCeilingReached: true,
      costUsd: expect.closeTo(1.31, 5),
      error: expect.stringContaining('cost ceiling reached ($1.31 of $1.20): approvalCheck'),
    })
    expect(exists('review.json')).toBe(false)
    expect(exists('report.json')).toBe(false)
    expect(exists('preview.md')).toBe(false)
    expect(exists('failed-steps.json')).toBe(false)
    expect(lines.filter((line) => line.includes('not started'))).toHaveLength(1)
  })

  it('stops whole when the ceiling keeps the evidence step from starting, even with the check off', async () => {
    const { outcome, exists } = await run({ ceilingUsd: 1.2, check: false, evidence: true })
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toMatchObject({
      costCeilingReached: true,
      error: expect.stringContaining('evidence did not start'),
    })
    expect(exists('review.json')).toBe(false)
  })

  it('stops after the pillars that were running, before the verifier, and records no harness failure', async () => {
    const { outcome, exists, prompts } = await run({ ceilingUsd: 0.12 })
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toMatchObject({
      costCeilingReached: true,
      costUsd: expect.closeTo(0.21, 5),
      error: expect.stringContaining('cost ceiling reached ($0.21 of $0.12): pillar.'),
    })
    expect(prompts.some((prompt) => prompt.includes('VERIFIER prompt text'))).toBe(false)
    expect(exists('verifier.json')).toBe(false)
    expect(exists('failed-steps.json')).toBe(false)
  })

  it('still finishes the review when the last step to run is the one that crosses it', async () => {
    // 0.01 + 0.3 + 1 + 0.5 = 1.81: the check pushes the total over 1.8 and nothing is left to start.
    const { outcome } = await run({ ceilingUsd: 1.8 })
    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toMatchObject({ verdict: 'Approve' })
  })
})
