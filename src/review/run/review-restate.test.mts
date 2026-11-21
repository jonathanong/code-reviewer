import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { Restatable } from '../context/restatable.mts'
import type { ReviewPlan } from '../plan.mts'
import { runReview, type ReviewSteps } from './review.mts'
import { restatableOf } from './verifier-context.mts'

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
const LINK = 'https://example.test/pull/4#discussion_r9'
const ITEM: Restatable = {
  login: 'codex[bot]',
  url: LINK,
  where: 'a.ts:1',
  stated: 'P1 (Codex; high tier)',
  text: 'Cache is never invalidated.',
}
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

async function run(context: object) {
  const out = mkdtempSync(join(tmpdir(), 'review-restate-'))
  dirs.push(out)
  const calls: { prompt: string; schema: string }[] = []
  const exec: Exec = async (command, args) => {
    if (command === 'git') return ''
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: [] })
    if (prompt.includes('VERIFIER prompt text')) {
      calls.push({ prompt, schema: args[args.indexOf('--json-schema') + 1] as string })
      return result({
        summary: 's',
        pullRequestSummary: 'p',
        findings: [
          {
            pillar: 'correctness',
            severity: 'blocking',
            title: 'Stale cache',
            body: 'The cache is never invalidated.',
            path: 'a.ts',
            line: 1,
            sources: [],
            raisedBy: { login: 'codex[bot]', url: LINK },
          },
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
      writeFileSync(join(out, 'context.json'), JSON.stringify({ title: 'T', ...context }))
      return { headSha: 'd'.repeat(40), baseSha: 'c'.repeat(40), plan: PLAN }
    },
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Request Changes', reviews: [] }),
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
    report: readFileSync(join(out, 'report.md'), 'utf8'),
  }
}

describe('runReview with another reviewer open item', () => {
  it('gives the verifier the item and carries the credit into review.json and the report', async () => {
    const { call, review, report } = await run({ restatable: [ITEM] })
    expect(call.prompt).toContain("## Other reviewers' open blocking and high items")
    expect(call.prompt).toContain(LINK)
    expect(call.schema).toContain('raisedBy')
    expect(review.findings[0].raisedBy).toEqual({ login: 'codex[bot]', url: LINK })
    expect(report).toContain(`Also raised by [codex](${LINK})`)
    expect(report).not.toContain('@')
  })

  it('adds no block and no schema field without an item, and drops a credit it was not given', async () => {
    const { call, review } = await run({})
    expect(call.prompt).not.toContain('Other reviewers')
    expect(call.schema).not.toContain('raisedBy')
    expect(review.findings[0]).not.toHaveProperty('raisedBy')
  })
})

describe('restatableOf', () => {
  it('reads the list from context.json and treats a missing or odd value as none', () => {
    const out = mkdtempSync(join(tmpdir(), 'restatable-of-'))
    dirs.push(out)
    const write = (value: object) => writeFileSync(join(out, 'context.json'), JSON.stringify(value))
    write({ restatable: [ITEM] })
    expect(restatableOf(out)).toEqual([ITEM])
    write({ restatable: 'x' })
    expect(restatableOf(out)).toEqual([])
    write({})
    expect(restatableOf(out)).toEqual([])
  })
})
