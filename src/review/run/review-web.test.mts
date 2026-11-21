import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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
  pillars: ['rules', 'correctness', 'security'].map((pillar) => ({
    pillar,
    model: 'sonnet',
  })) as ReviewPlan['pillars'],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

/** Runs a review with a fake `claude` and returns the arguments of every call, run paths masked. */
async function run(webReferences?: ReviewSteps['webReferences']) {
  const out = mkdtempSync(join(tmpdir(), 'review-web-'))
  dirs.push(out)
  const seen: string[][] = []
  const exec: Exec = async (_command, args) => {
    seen.push(args.map((arg) => arg.split(out).join('RUN')))
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') {
      return result({ skills: ['jong-skills:documentation'] })
    }
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
      return { headSha: 'd'.repeat(40), plan: PLAN }
    },
    abort: vi.fn(async () => undefined),
    preview: async () => ({ verdict: 'Approve', reviews: [] }),
    plugins: async () => ({
      enabled: [],
      installs: [{ name: 'jong-skills', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    rulePlugins: ['jong-skills'],
    exec,
    references: fixture('references'),
    ...(webReferences === undefined ? {} : { webReferences }),
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, {
    repo: 'acme/widgets',
    pr: 4,
    out,
    tree: '/tree',
    jobs: 1,
  })
  expect(outcome.ok).toBe(true)
  return seen
}

describe('runReview web references', () => {
  const sources = [{ name: 'aws', description: 'AWS docs', domains: ['docs.aws.amazon.com'] }]

  it('gives correctness, security and the verifier the references, and no other run', async () => {
    const seen = await run(sources)
    const prompt = (args: string[]) => args[1] as string
    const withWeb = seen.filter((args) => args.join(' ').includes('WebFetch(domain:'))
    const names = ['correctness prompt text', 'security prompt text', 'VERIFIER prompt text']
    expect(withWeb.map((args) => names.find((name) => prompt(args).includes(name)))).toEqual(names)
    for (const args of withWeb) expect(prompt(args)).toContain('WEB RULES text')
    const others = seen.filter((args) => !withWeb.includes(args))
    expect(others.length).toBeGreaterThan(0)
    for (const args of others) expect(args.join(' ')).not.toContain('WebFetch')
  })

  it('runs identically with an empty list and with none', async () => {
    const none = await run()
    expect(await run([])).toEqual(none)
    expect(JSON.stringify(none)).not.toContain('WebFetch')
  })
})
