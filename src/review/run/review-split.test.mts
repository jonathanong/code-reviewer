import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import {
  handWrittenOnlyRepo,
  mechanicalOnlyRepo,
  mixedRepo,
  smallRepo,
} from '../context/change-shape/split-fixtures.mts'
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
const PROPOSAL =
  'Move the 40 files changed only by enabling `prefer-const` into their own pull request.'
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

async function run(git: Exec, verifierExtra: object) {
  const out = mkdtempSync(join(tmpdir(), 'review-split-'))
  dirs.push(out)
  const calls: { prompt: string; schema: string }[] = []
  const exec: Exec = async (command, args, options) => {
    if (command === 'git') return git(command, args, options)
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: [] })
    if (prompt.includes('VERIFIER prompt text')) {
      calls.push({ prompt, schema: args[args.indexOf('--json-schema') + 1] as string })
      return result({ summary: 's', pullRequestSummary: 'p', findings: [], ...verifierExtra })
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
  await runReview(steps, { repo: 'acme/widgets', pr: 4, out, tree: '/tree', jobs: 1 })
  return {
    call: calls[0] as { prompt: string; schema: string },
    review: JSON.parse(readFileSync(join(out, 'review.json'), 'utf8')),
    report: JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')),
    reportText: readFileSync(join(out, 'report.md'), 'utf8'),
    contextFile: readFileSync(join(out, 'review-context.md'), 'utf8'),
  }
}

describe('runReview with a large change that mixes mechanical and other changes', () => {
  it('gives the verifier the measurement and carries its proposal into the review and report', async () => {
    const { call, review, report, reportText, contextFile } = await run(mixedRepo(), {
      splitProposal: PROPOSAL,
    })
    expect(call.prompt).toContain('## Large change with a mechanical part')
    expect(call.prompt).toContain('"remainder"')
    expect(call.schema).toContain('splitProposal')
    expect(review.splitProposal).toBe(PROPOSAL)
    expect(report.splitProposal).toBe(PROPOSAL)
    expect(reportText).toContain(`### Proposed split\n\n${PROPOSAL}`)
    expect(contextFile).not.toContain('Change shape')
  })

  it('leaves the verdict as it is without a proposal, and a proposal changes nothing but itself', async () => {
    const proposed = await run(mixedRepo(), { splitProposal: PROPOSAL })
    const declined = await run(mixedRepo(), {})
    expect(declined.review).not.toHaveProperty('splitProposal')
    expect(declined.call.prompt).toContain('## Large change with a mechanical part')
    expect(proposed.report.verdict).toBe('Approve')
    // Each review has its own id, so the two differ in that and the proposal only.
    const { splitProposal: _kept, reviewId: _id, ...rest } = proposed.review
    const { reviewId: _other, ...bare } = declined.review
    expect(rest).toEqual(bare)
    expect(proposed.report.findings).toEqual(declined.report.findings)
  })
})

describe('runReview with a change that needs no proposal', () => {
  it.each([
    ['a small change', smallRepo()],
    ['a purely mechanical change', mechanicalOnlyRepo()],
    ['a large change with nothing mechanical', handWrittenOnlyRepo()],
  ])(
    'adds no block and no field for %s, and drops a proposal it was not asked for',
    async (_name, git) => {
      const { call, review, reportText } = await run(git, { splitProposal: PROPOSAL })
      expect(call.prompt).not.toContain('Large change with a mechanical part')
      expect(call.schema).not.toContain('splitProposal')
      expect(review).not.toHaveProperty('splitProposal')
      expect(reportText).not.toContain('Proposed split')
    },
  )
})
