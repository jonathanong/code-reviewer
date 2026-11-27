import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { completedHead } from '../complete-file.mts'
import { FINDING, QUESTION } from '../earlier-fake-io.mts'
import type { ReviewPlan } from '../plan.mts'
import { runReview, type ReviewSteps } from './review.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = (name: string) => fileURLToPath(new URL(name, import.meta.url))
const HELD = fixture('./fixtures/earlier-held')
const EARLIER_SHA = '1'.repeat(40)
const HEAD = 'd'.repeat(40)
const MOVED = { ...FINDING, title: 'Lock removed', line: 3 }
const GONE = { ...FINDING, title: 'Unused import', severity: 'low', line: 9 }
const PLAN: ReviewPlan = {
  upToDate: false,
  mode: 'light',
  effort: 'low',
  sinceSha: null,
  push: 'rebase-same-change',
  pillars: [{ pillar: 'correctness', model: 'sonnet' }],
  verifierModel: 'sonnet',
  skipped: [],
  reasons: [],
}
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

/**
 * Runs a review whose prepare carried an unposted review forward. The base changed src/a.ts, which
 * the pull request also changes, so the carried finding on it now sits at line 5.
 */
async function run({ carried = true, changed = '' }: { carried?: boolean; changed?: string } = {}) {
  const out = mkdtempSync(join(tmpdir(), 'review-earlier-'))
  dirs.push(out)
  const prompts: string[] = []
  const exec: Exec = async (command, args) => {
    if (command === 'git') return args.includes('diff') ? changed : ''
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: [] })
    if (prompt.includes('VERIFIER prompt text')) {
      prompts.push(prompt)
      if (!prompt.includes('never posted'))
        return result({ summary: 's', pullRequestSummary: 'p', findings: [] })
      return result({
        summary: 's',
        pullRequestSummary: 'p',
        findings: [{ ...MOVED, line: 5, sources: [0] }],
        dropped: [{ index: 1, reason: 'The import is used after the rebase.' }],
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
      if (carried) {
        const file = {
          sha: EARLIER_SHA,
          runDir: HELD,
          verdict: 'Request Changes',
          findings: [MOVED, GONE],
          questions: [QUESTION],
        }
        writeFileSync(join(out, 'earlier.json'), JSON.stringify(file))
      }
      return { headSha: HEAD, baseSha: 'c'.repeat(40), plan: PLAN }
    },
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Request Changes', reviews: [] }),
    plugins: async () => ({
      enabled: [{ id: 'ratchet-workflows@m', version: '1' }],
      installs: [{ name: 'ratchet-workflows', installPath: fixture('./fixtures/plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: ['ratchet-workflows'],
    stateDir: out,
    exec,
    references: fixture('./fixtures/references'),
  } as unknown as ReviewSteps
  await runReview(steps, { repo: 'acme/widgets', pr: 4, out, tree: '/tree', jobs: 1 })
  const read = (name: string) => readFileSync(join(out, name), 'utf8')
  return {
    prompt: prompts[0] as string,
    review: JSON.parse(read('review.json')) as { findings: { title: string; line: number }[] },
    out,
  }
}

describe('runReview of a head the earlier, unposted review did not see', () => {
  it('has the verifier re-place the carried findings, drop one, and return the whole review', async () => {
    const { prompt, review } = await run()
    expect(prompt).toContain('## Your earlier review of this pull request, never posted')
    expect(prompt).toContain(QUESTION.question)
    expect(prompt).toContain('Lock removed')
    expect(prompt).toContain('Unused import')
    expect(review.findings.map(({ title, line }) => ({ title, line }))).toEqual([
      { title: 'Lock removed', line: 5 },
    ])
  })

  it('offers only the earlier evidence whose declared paths did not change', async () => {
    const kept = await run({ changed: 'src/a.ts\0' })
    expect(kept.prompt).toContain('"source": "docs"')
    expect(kept.prompt).not.toContain('"source": "logs"')
    const stale = await run({ changed: 'docs/api.md\0src/a.ts\0' })
    expect(stale.prompt).not.toContain('still applies')
  })

  it('adds nothing without a carried review', async () => {
    const { prompt } = await run({ carried: false })
    expect(prompt).not.toContain('never posted')
  })

  it('marks the run complete only once review.json is written', async () => {
    const { out } = await run()
    expect(completedHead((path) => readFileSync(path, 'utf8'), out)).toBe(HEAD)
    expect(existsSync(join(out, 'review.json'))).toBe(true)
  })
})
