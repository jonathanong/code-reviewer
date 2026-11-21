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

const fixture = (name: string) => fileURLToPath(new URL(name, import.meta.url))
const EARLIER = fixture('../context/fixtures/state/run-1')
const OLD = '1'.repeat(40)
const PLAN: ReviewPlan = {
  upToDate: false,
  mode: 'light',
  effort: 'low',
  sinceSha: OLD,
  pillars: [{ pillar: 'rules', model: 'sonnet' }],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

type Setup = { sinceSha?: string | null; runDir?: string; ancestor?: boolean }

async function run({ sinceSha = OLD, runDir = EARLIER, ancestor = true }: Setup = {}) {
  const out = mkdtempSync(join(tmpdir(), 'review-previous-'))
  const state = mkdtempSync(join(tmpdir(), 'review-previous-state-'))
  dirs.push(out, state)
  const row = { repo: 'acme/widgets', pr: 4, head: OLD, state: 'posted', mode: 'full', runDir }
  writeFileSync(join(state, 'reviews.jsonl'), `${JSON.stringify(row)}\n`)
  const prompts: string[] = []
  const exec: Exec = async (command, args) => {
    if (command === 'git') {
      if (args.includes('--is-ancestor') && !ancestor) throw new Error('not an ancestor')
      return ''
    }
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: [] })
    if (prompt.includes('VERIFIER prompt text')) {
      prompts.push(prompt)
      return result({ summary: 's', pullRequestSummary: 'p', findings: [] })
    }
    return result({ findings: [] })
  }
  const steps = {
    claim: async () => ({ claimed: true }),
    prepare: async () => {
      mkdirSync(join(out, 'diff'), { recursive: true })
      mkdirSync(join(out, 'since'), { recursive: true })
      writeFileSync(join(out, 'diff', 'INDEX.md'), '- a.ts')
      writeFileSync(join(out, 'since', 'INDEX.md'), '- a.ts')
      writeFileSync(join(out, 'since.patch'), 'diff --git a/a.ts b/a.ts\n+x\n')
      writeFileSync(join(out, 'diff.patch'), 'diff --git a/a.ts b/a.ts\n+x\n')
      writeFileSync(join(out, 'context.json'), JSON.stringify({ title: 'T' }))
      const plan = { ...PLAN, sinceSha }
      return { headSha: 'd'.repeat(40), baseSha: 'c'.repeat(40), plan }
    },
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Approve', reviews: [] }),
    plugins: async () => ({
      enabled: [{ id: 'jong-skills@m', version: '1' }],
      installs: [{ name: 'jong-skills', installPath: fixture('./fixtures/plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: ['jong-skills'],
    stateDir: state,
    exec,
    references: fixture('./fixtures/references'),
  } as unknown as ReviewSteps
  await runReview(steps, { repo: 'acme/widgets', pr: 4, out, tree: '/tree', jobs: 1 })
  return {
    prompt: prompts[0] as string,
    reportText: readFileSync(join(out, 'report.md'), 'utf8'),
  }
}

describe('runReview of a follow-up', () => {
  it('gives the verifier the earlier review of this machine', async () => {
    const { prompt, reportText } = await run()
    expect(prompt).toContain('## Your earlier review of this pull request')
    expect(prompt).toContain(`"sha": "${OLD}"`)
    expect(prompt).toContain('Token logged in clear')
    expect(reportText).not.toContain('Earlier review:')
  })

  it('adds nothing on a first review', async () => {
    const { prompt } = await run({ sinceSha: null })
    expect(prompt).not.toContain('Your earlier review')
  })

  it('adds nothing when the earlier head is no ancestor of the head', async () => {
    const { prompt, reportText } = await run({ ancestor: false })
    expect(prompt).not.toContain('Your earlier review')
    expect(reportText).not.toContain('Earlier review:')
  })

  it('goes on without it and says so in the report when the run directory is gone', async () => {
    const { prompt, reportText } = await run({ runDir: '/nowhere/run' })
    expect(prompt).not.toContain('Your earlier review')
    expect(reportText).toContain('Earlier review: not given to the verifier (the run directory')
  })
})
