import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { PriorFinding } from '../context.mts'
import type { Finding } from '../finding.mts'
import type { ReviewPlan } from '../plan.mts'
import { deriveVerdict } from '../render.mts'
import { runReview, type ReviewSteps } from './review.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = (name: string) => fileURLToPath(new URL(name, import.meta.url))
const HEAD = 'd'.repeat(40)
const REVIEWED = '9'.repeat(40)
const PLAN: ReviewPlan = {
  upToDate: false,
  mode: 'light',
  effort: 'low',
  sinceSha: REVIEWED,
  pillars: [{ pillar: 'correctness', model: 'sonnet' }],
  verifierModel: 'sonnet',
  skipped: [],
  reasons: [],
}
// The shape of jongleberry/no-mistakes#4683: a high finding whose line was not in the diff.
const BODY: PriorFinding = {
  threadId: null,
  severity: 'high',
  pillar: 'correctness',
  title: 'Factory capture reads the raw callee',
  path: 'src/rule.js',
  line: 84,
  outdated: false,
  body: 'A wrapped `vi.mock` gives a false shared report.',
}
const THREAD: PriorFinding = { ...BODY, threadId: 'PRRT_1', title: 'A thread finding' }
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

type Answer = Record<string, unknown>

/** Runs a light follow-up whose earlier review left `unresolved`, with a verifier that answers `answer`. */
async function run(unresolved: PriorFinding[], answer: Answer = {}) {
  const out = mkdtempSync(join(tmpdir(), 'review-body-'))
  dirs.push(out)
  const prompts: string[] = []
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: [] })
    if (prompt.includes('VERIFIER prompt text')) {
      prompts.push(prompt)
      return result({ summary: 's', pullRequestSummary: 'p', findings: [], ...answer })
    }
    return result({ findings: [] })
  }
  const steps = {
    claim: async () => ({ claimed: true }),
    prepare: async () => {
      mkdirSync(join(out, 'diff'), { recursive: true })
      writeFileSync(join(out, 'diff', 'INDEX.md'), '- a.ts')
      mkdirSync(join(out, 'since'), { recursive: true })
      writeFileSync(join(out, 'since', 'INDEX.md'), '- a.ts')
      writeFileSync(join(out, 'since.patch'), 'diff --git a/a.ts b/a.ts\n+x\n')
      writeFileSync(join(out, 'diff.patch'), 'diff --git a/a.ts b/a.ts\n+x\n')
      writeFileSync(
        join(out, 'context.json'),
        JSON.stringify({ title: 'T', reviewedSha: REVIEWED, unresolved }),
      )
      return { headSha: HEAD, baseSha: 'c'.repeat(40), plan: PLAN }
    },
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Comment', reviews: [] }),
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
  const review = JSON.parse(readFileSync(join(out, 'review.json'), 'utf8')) as {
    findings: Finding[]
    questions: []
    skipped: []
  }
  return { prompt: prompts[0] as string, review }
}

const verdictOf = (review: Awaited<ReturnType<typeof run>>['review']) =>
  deriveVerdict(review.findings, review.questions, review.skipped)

describe('runReview of a follow-up with an open finding that has no thread', () => {
  it('lists the finding as an input with its own block, after the other findings', async () => {
    const { prompt } = await run([BODY])
    expect(prompt).toContain('## Your earlier findings that have no thread')
    expect(prompt).toContain('the 1 input findings from index 0 on')
    expect(prompt).toContain('Factory capture reads the raw callee')
  })

  it('keeps the finding, and the verdict at Comment, when the verifier says nothing about it', async () => {
    const { review } = await run([BODY])
    expect(review.findings).toMatchObject([
      { severity: 'high', title: BODY.title, path: 'src/rule.js', line: 84, body: BODY.body },
    ])
    expect(verdictOf(review)).toBe('Comment')
  })

  it('keeps the verifier’s own finding for the same claim and does not add a copy', async () => {
    const kept = {
      pillar: 'correctness',
      severity: 'high',
      title: BODY.title,
      body: 'Still reads node.callee at line 84.',
      sources: [0],
    }
    const { review } = await run([BODY], { findings: [kept] })
    expect(review.findings).toHaveLength(1)
    expect(review.findings[0]?.body).toBe('Still reads node.callee at line 84.')
    expect(verdictOf(review)).toBe('Comment')
  })

  it('lets the verifier retire the finding with a reason, and then the verdict improves', async () => {
    const { review } = await run([BODY], {
      dropped: [{ index: 0, reason: 'Line 84 now unwraps the callee chain.' }],
    })
    expect(review.findings).toEqual([])
    expect(verdictOf(review)).toBe('Approve')
  })

  it('does not treat a reason-less drop as an answer', async () => {
    const { review } = await run([BODY], { dropped: [{ index: 0, reason: ' ' }] })
    expect(verdictOf(review)).toBe('Comment')
  })

  it('leaves a thread to its thread and adds no block for it', async () => {
    const { prompt, review } = await run([THREAD])
    expect(prompt).not.toContain('no thread')
    expect(review.findings).toEqual([])
  })

  it('skips an earlier finding whose severity or pillar it cannot read', async () => {
    const { prompt } = await run([
      { ...BODY, severity: 'urgent' },
      { ...BODY, pillar: 'No Pillar' },
    ])
    expect(prompt).not.toContain('## Your earlier findings that have no thread')
  })
})
