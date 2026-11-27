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
const SHA = 'a'.repeat(40)
const ADVICE = 'Code MUST NOT change a cache key without a test that pins it.'
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

/** A git fake: the pull request's commit messages are `log`, and one commit is known in history. */
function gitFake(log: string): Exec {
  return async (_command, args) => {
    const git = args.slice(2)
    if (git[0] === 'log' && git.at(-1) === `${'c'.repeat(40)}..${'d'.repeat(40)}`) {
      return git.includes('--format=%B%x1e') ? log : ''
    }
    if (git[0] === 'cat-file' && !String(git.at(-1)).startsWith(SHA)) throw new Error('missing')
    if (git[0] === 'show')
      return `${SHA}\u001faaaaaaa\u001f2024-01-01\u001fAdd cache\nsrc/cache.ts\n`
    return ''
  }
}

async function run(log: string, verifierExtra: object) {
  const out = mkdtempSync(join(tmpdir(), 'review-regression-'))
  dirs.push(out)
  const git = gitFake(log)
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
      enabled: [{ id: 'ratchet-workflows@m', version: '1' }],
      installs: [{ name: 'ratchet-workflows', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: ['ratchet-workflows'],
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  await runReview(steps, { repo: 'acme/widgets', pr: 4, out, tree: '/tree', jobs: 1 })
  return {
    call: calls[0] as { prompt: string; schema: string },
    review: JSON.parse(readFileSync(join(out, 'review.json'), 'utf8')),
    report: readFileSync(join(out, 'report.md'), 'utf8'),
  }
}

describe('runReview with a change that fixes a regression', () => {
  it('gives the verifier the found commit and carries its recommendation into review.json and the report', async () => {
    const { call, review, report } = await run(`Fixes ${SHA}\u001e`, { regressionPrevent: ADVICE })
    expect(call.prompt).toContain('## Commits this change says it fixes or reverts')
    expect(call.prompt).toContain(`"sha": "${SHA}"`)
    expect(call.schema).toContain('regressionPrevent')
    expect(review.regressionPrevent).toBe(ADVICE)
    expect(report).toContain(`<summary>Preventing this regression</summary>\n\n${ADVICE}`)
    expect(report).toContain('Add cache (fixes)')
  })

  it('adds no block and no schema field without a found commit, and drops a note it was not asked for', async () => {
    const { call, review, report } = await run('Add feature\u001e', { regressionPrevent: ADVICE })
    expect(call.prompt).not.toContain('says it fixes or reverts')
    expect(call.schema).not.toContain('regressionPrevent')
    expect(review).not.toHaveProperty('regressionPrevent')
    expect(report).not.toContain('Preventing this regression')
  })

  it('adds no block when the referenced commit is not in local history', async () => {
    const { call } = await run(`Fixes ${'b'.repeat(40)}\u001e`, {})
    expect(call.prompt).not.toContain('says it fixes or reverts')
  })
})
