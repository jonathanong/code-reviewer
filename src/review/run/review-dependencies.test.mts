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
  pillars: [{ pillar: 'correctness', model: 'sonnet' }],
  verifierModel: 'sonnet',
  skipped: [],
  reasons: [],
}
const KNOWN = [{ on: '#12', kind: 'pull', state: 'open', why: 'Named in the description.' }]
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

/** Runs a review with a fake `claude`; `push` is what `prepare` left in `push.json`. */
async function run(files: Record<string, object> = {}) {
  const out = mkdtempSync(join(tmpdir(), 'review-carried-'))
  dirs.push(out)
  const prompts: string[] = []
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') {
      return result({ skills: ['ratchet-workflows:documentation'] })
    }
    prompts.push(prompt)
    if (prompt.includes('VERIFIER prompt text')) {
      return result({
        summary: 's',
        pullRequestSummary: 'p',
        findings: [],
        dependencies: [
          { on: 'orders service', kind: 'api', why: 'Needs the new route.', state: 'merged' },
          { on: '#12', kind: 'api', why: 'duplicate' },
        ],
      })
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
      for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(out, name), JSON.stringify(body))
      }
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
  return {
    prompts,
    report: JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')),
    review: JSON.parse(readFileSync(join(out, 'review.json'), 'utf8')),
  }
}

describe('runReview with dependencies', () => {
  it('tells only the verifier, merges what it implied, and reports it', async () => {
    const { prompts, report, review } = await run({ 'dependencies.json': KNOWN })
    expect(prompts.filter((prompt) => prompt.includes('## Known dependencies'))).toHaveLength(1)
    const expected = [
      ...KNOWN,
      { on: 'orders service', kind: 'api', state: 'unknown', why: 'Needs the new route.' },
    ]
    expect(review.dependencies).toEqual(expected)
    expect(report.dependencies).toEqual(expected)
  })

  it('tells only the verifier about linked issues, and not at all without issues.json', async () => {
    const issues = [{ ref: 'acme/lib#2', state: 'open', title: 'Add retries', body: 'x' }]
    const withIssues = await run({ 'issues.json': issues })
    expect(withIssues.prompts.filter((prompt) => prompt.includes('## Linked issues'))).toHaveLength(
      1,
    )
    const without = await run()
    for (const prompt of without.prompts) expect(prompt).not.toContain('Linked issues')
  })

  it('records only what the verifier implied when prepare found nothing', async () => {
    const { prompts, review } = await run()
    for (const prompt of prompts) expect(prompt).not.toContain('Known dependencies')
    expect(review.dependencies.map((entry: { on: string }) => entry.on)).toEqual([
      'orders service',
      '#12',
    ])
  })
})
