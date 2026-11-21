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
const CARRIED = {
  commits: [{ sha: 'f'.repeat(40), subject: 'Landed', home: { kind: 'default' }, how: 'patch' }],
  commitsInRange: 2,
  files: ['landed.ts'],
  filesTotal: 1,
  defaultBranch: 'main',
  base: 'missing',
  problems: [],
  baseRef: 'parent',
}
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

/** Runs a review with a fake `claude`; `push` is what `prepare` left in `push.json`. */
async function run(files: Record<string, object> = {}) {
  const out = mkdtempSync(join(tmpdir(), 'review-carried-'))
  dirs.push(out)
  const prompts: string[] = []
  const exec: Exec = async (command, args) => {
    if (command === 'git') return ''
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') {
      return result({ skills: ['jong-skills:documentation'] })
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
      for (const [name, body] of Object.entries(files)) {
        writeFileSync(join(out, name), JSON.stringify(body))
      }
      return { headSha: SHA, plan: PLAN }
    },
    preview: async () => ({ verdict: 'Approve', reviews: [] }),
    plugins: async () => ({
      enabled: [],
      installs: [{ name: 'jong-skills', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    rulePlugins: ['jong-skills'],
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

describe('runReview with carried commits', () => {
  it('tells the pillar and the verifier, reports it, and posts one note', async () => {
    const { prompts, report, review } = await run({ 'carried.json': CARRIED })
    expect(prompts).toHaveLength(2)
    for (const prompt of prompts) expect(prompt).toContain('## Carried changes')
    expect(report.carried).toMatchObject({ base: 'missing', commitsInRange: 2 })
    expect(review.notes).toHaveLength(2)
    expect(review.notes[0]).toContain('Base branch `parent` no longer exists')
  })

  it('notes a dead base even when no commit is carried, without a prompt block', async () => {
    const { prompts, review } = await run({ 'carried.json': { ...CARRIED, commits: [] } })
    for (const prompt of prompts) expect(prompt).not.toContain('Carried changes')
    expect(review.notes).toHaveLength(1)
  })

  it('leaves every prompt, review.json and the report as they were without carried.json', async () => {
    const { prompts, report, review } = await run()
    for (const prompt of prompts) expect(prompt).not.toContain('Carried changes')
    expect(report.carried).toBeUndefined()
    expect(Object.keys(review).sort()).toEqual([
      'effort',
      'findings',
      'questions',
      'skipped',
      'summary',
    ])
  })
})
