import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { extraPillar } from '../pillar-name.mts'
import type { ReviewPlan } from '../plan.mts'
import { runReview, type ReviewSteps } from './review.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const a11y = extraPillar('a11y')
const PLAN: ReviewPlan = {
  upToDate: false,
  mode: 'full',
  effort: 'high',
  sinceSha: null,
  pillars: [
    { pillar: 'rules', model: 'sonnet' },
    { pillar: a11y, model: 'sonnet' },
  ],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const result = (structured: unknown) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.1,
    num_turns: 1,
    structured_output: structured,
  })

type Seen = { prompt: string; schema: string }

async function run(extraAnswer: 'findings' | 'broken', plan: ReviewPlan = PLAN) {
  const out = mkdtempSync(join(tmpdir(), 'review-pillars-'))
  dirs.push(out)
  const seen: Seen[] = []
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    seen.push({ prompt, schema: args[args.indexOf('--json-schema') + 1] as string })
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: [] })
    if (prompt.includes('VERIFIER prompt text')) {
      return result({
        summary: 'S.',
        pullRequestSummary: 'P.',
        findings: prompt.includes('No label')
          ? [
              {
                pillar: 'a11y',
                severity: 'medium',
                title: 'No label',
                body: 'b',
                path: 'a.tsx',
                line: 2,
                sources: [0],
              },
            ]
          : [],
      })
    }
    if (prompt.includes('Look for missing labels.')) {
      if (extraAnswer === 'broken') return 'not json'
      return result({
        findings: [{ severity: 'medium', title: 'No label', body: 'b', path: 'a.tsx', line: 2 }],
      })
    }
    return result({ findings: [] })
  }
  const steps = {
    claim: async () => ({ claimed: true }),
    prepare: async () => {
      mkdirSync(join(out, 'diff'), { recursive: true })
      writeFileSync(join(out, 'diff', 'INDEX.md'), '- a.tsx')
      writeFileSync(join(out, 'diff.patch'), 'diff --git a/a.tsx b/a.tsx\n+x\n')
      writeFileSync(join(out, 'context.json'), JSON.stringify({ title: 'T' }))
      return { headSha: 'd'.repeat(40), plan }
    },
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Comment', reviews: [] }),
    plugins: async () => ({ enabled: [], installs: [] }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: [],
    pillars: {
      disabled: [],
      extra: [
        {
          name: a11y,
          modes: ['full'],
          when: 'the change touches UI',
          source: { prompt: 'Look for missing labels.' },
        },
      ],
    },
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
  return { outcome, out, seen }
}

describe('runReview with a configured pillar', () => {
  it('runs it, lets the verifier keep its finding, and shows it by name in the report', async () => {
    const { outcome, out, seen } = await run('findings')
    expect(outcome.ok).toBe(true)
    const review = JSON.parse(readFileSync(join(out, 'review.json'), 'utf8'))
    expect(review.findings).toEqual([
      expect.objectContaining({ pillar: 'a11y', title: 'No label' }),
    ])
    const verifier = seen.find((call) => call.prompt.includes('VERIFIER prompt text'))
    expect(verifier?.schema).toContain('"a11y"')
    expect(readFileSync(join(out, 'pillars', 'a11y.json'), 'utf8')).toContain('"pillar": "a11y"')
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('a11y')
  })

  it('reports an extra that failed as skipped, and still completes the review', async () => {
    const { outcome, out } = await run('broken')
    expect(outcome.ok).toBe(true)
    const review = JSON.parse(readFileSync(join(out, 'review.json'), 'utf8'))
    expect(review.skipped).toEqual([
      expect.objectContaining({ pillar: 'a11y', reason: expect.stringContaining('failed twice') }),
    ])
    expect(readFileSync(join(out, 'pillars', 'a11y.json'), 'utf8')).toContain('"error"')
  })

  it('fails the review when the config leaves no pillar for the change', async () => {
    const { outcome } = await run('findings', { ...PLAN, pillars: [] })
    expect(outcome.ok).toBe(false)
    expect(outcome.summary.error).toMatch(/No pillar is planned for this change/u)
  })
})
