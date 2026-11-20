import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
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
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

async function run(questions: unknown[]) {
  const out = mkdtempSync(join(tmpdir(), 'review-questions-'))
  dirs.push(out)
  const exec: Exec = async (_command, args) => {
    if (args[args.indexOf('--tools') + 1] === '') {
      return result({ skills: ['jong-skills:documentation'] })
    }
    if ((args[1] as string).includes('VERIFIER prompt text')) {
      return result({ summary: 's', pullRequestSummary: 'p', findings: [], questions })
    }
    return result({ findings: [] })
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
    preview: async () => ({ verdict: 'Comment', reviews: [] }),
    plugins: async () => ({
      enabled: [],
      installs: [{ name: 'jong-skills', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, {
    repo: 'acme/widgets',
    pr: 4,
    out,
    tree: '/tree',
    jobs: 1,
  })
  return { outcome, out }
}

describe('runReview questions', () => {
  it('turns an open question into a Comment verdict with no findings', async () => {
    const ask = { question: 'Is v1 gone?', askOf: 'product', why: 'Sets the rollout.' }
    const { outcome, out } = await run([ask])
    expect(outcome.summary).toMatchObject({ verdict: 'Comment', questions: 1 })
    expect(JSON.parse(readFileSync(join(out, 'review.json'), 'utf8')).questions).toEqual([ask])
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain(
      'Why it matters: Sets the rollout.',
    )
  })

  it('approves when there are no findings and no questions', async () => {
    const { outcome } = await run([])
    expect(outcome.summary).toMatchObject({ verdict: 'Approve', questions: 0 })
  })

  it('fails the review when the verifier returns a malformed question', async () => {
    const { outcome } = await run([{}])
    expect(outcome.ok).toBe(false)
  })
})
