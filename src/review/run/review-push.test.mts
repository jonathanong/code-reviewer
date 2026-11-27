import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { ReviewPlan } from '../plan.mts'
import { runReview, type ReviewSteps } from './review.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const SHA = 'd'.repeat(40)
const PLAN: ReviewPlan = {
  upToDate: false,
  mode: 'light',
  effort: 'low',
  sinceSha: null,
  push: 'base-merges-only',
  pillars: [{ pillar: 'correctness', model: 'sonnet' }],
  verifierModel: 'sonnet',
  skipped: [],
  reasons: [],
}
const PUSH = {
  kind: 'base-merges-only',
  reason: 'Every new commit merges the base.',
  reviewedSha: 'e'.repeat(40),
  headSha: SHA,
  merges: [{ sha: 'f'.repeat(40), resolution: 'resolved', file: 'merges/f.patch' }],
  mergesCapped: false,
  mergesTotal: 1,
  resolvedPaths: ['a.ts'],
  problems: [],
}
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

/** Runs a review with a fake `claude`; `push` is what `prepare` left in `push.json`. */
async function run(push?: object) {
  const out = mkdtempSync(join(tmpdir(), 'review-push-'))
  dirs.push(out)
  const prompts: string[] = []
  const exec: Exec = async (command, args) => {
    if (command === 'git') return ''
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') {
      return result({ skills: ['ratchet-workflows:documentation'] })
    }
    prompts.push(prompt)
    if (prompt.includes('VERIFIER prompt text')) {
      return result({ summary: 's', pullRequestSummary: 'p', findings: [] })
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
      if (push !== undefined) writeFileSync(join(out, 'push.json'), JSON.stringify(push))
      return { headSha: SHA, plan: PLAN }
    },
    preview: async () => ({ verdict: 'Approve', reviews: [] }),
    plugins: async () => ({
      enabled: [],
      installs: [{ name: 'ratchet-workflows', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    rulePlugins: ['ratchet-workflows'],
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  const options = { repo: 'acme/widgets', pr: 4, out, tree: '/tree', jobs: 1 }
  expect((await runReview(steps, options)).ok).toBe(true)
  return { prompts, report: JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')) }
}

describe('runReview after a push that only merges the base', () => {
  it('gives the pillar and the verifier the merge resolutions, and reports the push', async () => {
    const { prompts, report } = await run(PUSH)
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).toContain('## Merge resolutions')
    expect(report.push).toMatchObject({ kind: 'base-merges-only', mergesTotal: 1 })
  })

  it('leaves every prompt and the report as they were without push.json', async () => {
    const { prompts, report } = await run()
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).not.toContain('Merge resolutions')
    expect(report.push).toBeUndefined()
  })
})
