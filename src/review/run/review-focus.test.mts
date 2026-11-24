import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
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
  pillars: [
    { pillar: 'rules', model: 'sonnet' },
    { pillar: 'correctness', model: 'sonnet' },
  ],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const POINTS = ['the retry loop is bounded', 'logging stays quiet']
const result = (structured: unknown) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.1,
    num_turns: 1,
    structured_output: structured,
  })

type Seen = { prompt: string; schema: string; filesWithPoints: string[] }
type Answer = 'answers' | 'broken' | 'empty'

const FOCUS_ANSWER = {
  points: [
    { index: 0, status: 'holds', basis: 'It stops after 3 tries.', path: 'a.ts', line: 4 },
    { index: 1, status: 'does_not_hold', basis: 'It logs the token.', path: 'a.ts', line: 9 },
    { index: 7, status: 'holds', basis: 'Not a point that was supplied.', path: 'a.ts' },
  ],
  findings: [
    {
      severity: 'high',
      title: 'Token logged',
      body: 'The token is logged.',
      path: 'a.ts',
      line: 9,
    },
  ],
}

/** Every file under `dir` whose text holds one of the points, for the files a pillar could read. */
function filesWith(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) filesWith(path, found)
    else if (POINTS.some((point) => readFileSync(path, 'utf8').includes(point))) found.push(path)
  }
  return found
}

async function run(focus: readonly string[] | undefined, answer: Answer = 'answers') {
  const out = mkdtempSync(join(tmpdir(), 'review-focus-'))
  dirs.push(out)
  const seen: Seen[] = []
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    const schema = args[args.indexOf('--json-schema') + 1] as string
    seen.push({ prompt, schema, filesWithPoints: filesWith(out) })
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: [] })
    if (prompt.includes('VERIFIER prompt text')) {
      return result({
        summary: 'S.',
        pullRequestSummary: 'P.',
        findings: prompt.includes('Token logged')
          ? [
              {
                pillar: 'focus',
                severity: 'high',
                title: 'Token logged',
                body: 'The token is logged.',
                path: 'a.ts',
                line: 9,
                sources: [0],
              },
            ]
          : [],
      })
    }
    if (prompt.includes('# Requested checks')) {
      if (answer === 'broken') return 'not json'
      return result(answer === 'empty' ? { points: [], findings: [] } : FOCUS_ANSWER)
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
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Comment', reviews: [] }),
    plugins: async () => ({ enabled: [], installs: [] }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: [],
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, {
    repo: 'acme/widgets',
    pr: 4,
    out,
    tree: '/tree',
    jobs: 1,
    ...(focus === undefined ? {} : { focus }),
  })
  const review = JSON.parse(readFileSync(join(out, 'review.json'), 'utf8'))
  return { outcome, out, seen, review }
}

const isFocus = (call: Seen) => call.prompt.includes('# Requested checks')
const RUN_DIR = /review-focus-[A-Za-z0-9]+/gu
const others = (calls: Seen[]) => calls.filter((call) => !isFocus(call))
const statuses = (review: { focus: { status: string }[] }) =>
  review.focus.map((entry) => entry.status)

describe('runReview with requester focus points', () => {
  it('checks every point in one step beside the pillars and keeps the answers in the review', async () => {
    const { outcome, review, seen } = await run(POINTS)
    expect(outcome.ok).toBe(true)
    expect(seen.filter(isFocus)).toHaveLength(1)
    expect(review.focus).toEqual([
      {
        point: POINTS[0],
        status: 'holds',
        basis: 'It stops after 3 tries.',
        path: 'a.ts',
        line: 4,
      },
      {
        point: POINTS[1],
        status: 'does_not_hold',
        basis: 'It logs the token.',
        path: 'a.ts',
        line: 9,
      },
    ])
    expect(review.findings).toEqual([
      expect.objectContaining({ pillar: 'focus', title: 'Token logged' }),
    ])
    const verifier = seen.find((call) => call.prompt.includes('VERIFIER prompt text'))
    expect(verifier?.schema).toContain('"focus"')
  })

  it('shows the focus text to the focus step only, and writes it nowhere the others read', async () => {
    const { seen, out } = await run(POINTS)
    expect(others(seen).length).toBeGreaterThanOrEqual(4)
    for (const call of others(seen)) {
      for (const point of POINTS) expect(call.prompt).not.toContain(point)
      expect(call.filesWithPoints).toEqual([])
    }
    expect(seen.filter(isFocus)[0]?.prompt).toContain(POINTS[1])
    expect(filesWith(out)).toEqual([join(out, 'focus.json'), join(out, 'review.json')].sort())
  })

  it('marks every point not checked and lists the step as skipped when it fails', async () => {
    const { outcome, review } = await run(POINTS, 'broken')
    expect(outcome.ok).toBe(true)
    expect(statuses(review)).toEqual(['not_checked', 'not_checked'])
    expect(review.skipped).toEqual([
      expect.objectContaining({ pillar: 'focus', reason: expect.stringContaining('failed twice') }),
    ])
  })

  it('records a missing answer as not checked without calling the step failed', async () => {
    const { review } = await run(POINTS, 'empty')
    expect(statuses(review)).toEqual(['not_checked', 'not_checked'])
    expect(review.skipped).toEqual([])
  })

  it('changes no prompt and no schema when no point is given', async () => {
    const plain = await run(undefined)
    const withFocus = await run(POINTS, 'empty')
    expect(plain.seen.some(isFocus)).toBe(false)
    expect(plain.review.focus).toBeUndefined()
    const prompts = (calls: Seen[]) => others(calls).map((c) => c.prompt.replace(RUN_DIR, 'RUN'))
    expect(prompts(plain.seen)).toEqual(prompts(withFocus.seen))
    expect(plain.seen.map((call) => call.schema).join()).not.toContain('"focus"')
  })
})
