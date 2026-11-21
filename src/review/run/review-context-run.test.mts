import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { ReviewPlan } from '../plan.mts'
import { CONTEXT_FILE } from './review-context.mts'
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

/** Runs a review with a fake `claude` and a `git` that answers with nothing. */
async function run(selected: string[]) {
  const out = mkdtempSync(join(tmpdir(), 'review-context-run-'))
  dirs.push(out)
  const prompts: string[] = []
  const exec: Exec = async (command, args) => {
    if (command === 'git') return ''
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: selected })
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
      return { headSha: 'd'.repeat(40), baseSha: 'c'.repeat(40), plan: PLAN }
    },
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Approve', reviews: [] }),
    plugins: async () => ({
      enabled: [{ id: 'jong-skills@m', version: '1' }],
      installs: [{ name: 'jong-skills', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: ['jong-skills'],
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
  const pillar = prompts.find((prompt) => prompt.includes('rules prompt text')) as string
  const verifier = prompts.find((prompt) => prompt.includes('VERIFIER prompt text')) as string
  return { outcome, out, pillar, verifier, report: readFileSync(join(out, 'report.md'), 'utf8') }
}

describe('runReview context', () => {
  it('builds the context after skill selection and tells the pillar, not the verifier', async () => {
    const { outcome, out, pillar, verifier, report } = await run(['jong-skills:documentation'])
    expect(outcome.ok).toBe(true)
    const file = join(out, CONTEXT_FILE)
    expect(readFileSync(file, 'utf8')).toContain('### jong-skills:documentation')
    expect(pillar).toContain(`\`${file}\` is reference data collected mechanically`)
    expect(verifier).not.toContain(CONTEXT_FILE)
    expect(report).not.toContain('Context file: not built')
  })

  it('reviews without it and records why when the build has nothing to say', async () => {
    const { outcome, out, pillar, report } = await run([])
    expect(outcome.ok).toBe(true)
    expect(existsSync(join(out, CONTEXT_FILE))).toBe(false)
    expect(pillar).not.toContain(CONTEXT_FILE)
    expect(report).toContain('Context file: not built (no section had anything to say)')
  })
})
