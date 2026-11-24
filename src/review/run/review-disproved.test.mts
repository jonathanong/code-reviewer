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
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.1,
    num_turns: 1,
    structured_output: structured,
  })

// The second point does not hold, so the focus step raises one medium finding; the verifier keeps it.
const FOCUS_ANSWER = {
  points: [
    { index: 0, status: 'holds', basis: 'It stops after 3 tries.', path: 'a.ts', line: 4 },
    { index: 1, status: 'does_not_hold', basis: 'It logs the token.', path: 'a.ts', line: 9 },
  ],
  findings: [
    { severity: 'medium', title: 'Token logged', body: 'It is logged.', path: 'a.ts', line: 9 },
  ],
}
const KEPT = {
  pillar: 'focus',
  severity: 'medium',
  title: 'Token logged',
  body: 'It is logged.',
  path: 'a.ts',
  line: 9,
  sources: [0],
}

async function run(disproved: unknown[]) {
  const out = mkdtempSync(join(tmpdir(), 'review-disproved-'))
  dirs.push(out)
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: [] })
    if (prompt.includes('VERIFIER prompt text')) {
      return result({
        summary: 'S.',
        pullRequestSummary: 'P.',
        findings: [KEPT],
        disproved,
      })
    }
    if (prompt.includes('# Requested checks')) return result(FOCUS_ANSWER)
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
    skip: async () => undefined,
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Approve', reviews: [] }),
    plugins: async () => ({ enabled: [], installs: [] }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: [],
    exec,
    references: fileURLToPath(new URL('./fixtures/references', import.meta.url)),
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, {
    repo: 'acme/widgets',
    pr: 4,
    out,
    tree: '/tree',
    jobs: 1,
    focus: ['the retry loop is bounded', 'logging stays quiet'],
  })
  const read = (name: string) => JSON.parse(readFileSync(join(out, name), 'utf8'))
  return { outcome, review: read('review.json'), report: read('report.json') }
}

describe('runReview with a check the verifier says a kept finding disproves', () => {
  it('flips the check but leaves the verdict and the findings as they were', async () => {
    const without = await run([])
    const flipped = await run([
      { check: 0, finding: 0, reason: 'The retry loop never stops when one worker fails.' },
    ])
    expect(without.review.focus.map((entry: { status: string }) => entry.status)).toEqual([
      'holds',
      'does_not_hold',
    ])
    expect(flipped.review.focus[0]).toMatchObject({
      status: 'does_not_hold',
      basis: 'The retry loop never stops when one worker fails.',
      path: 'a.ts',
      line: 9,
    })
    expect(flipped.report.verdict).toBe('Approve')
    expect(flipped.report.verdict).toBe(without.report.verdict)
    expect(flipped.review.findings).toEqual(without.review.findings)
    expect(flipped.review.questions).toEqual(without.review.questions)
  })
})
