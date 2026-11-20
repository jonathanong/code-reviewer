import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { parseReviewInput } from '../finding.mts'
import type { ReviewPlan } from '../plan.mts'
import { runReview, type ReviewSteps } from './review.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const SHA = 'd'.repeat(40)

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
  skipped: [{ pillar: 'security', reason: 'No security trigger paths changed.' }],
  reasons: ['Large change.'],
}

const result = (structured: unknown, cost: number) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: cost,
    num_turns: 2,
    structured_output: structured,
  })

type Routes = {
  pillar?: (name: string) => string
  verifier?: () => string
  select?: () => string
  evidence?: () => string
}

/** Routes a fake `claude` call by what it is for: skill selection, verifier, or a pillar. */
function claude(routes: Routes = {}): Exec {
  return async (_command, args) => {
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') {
      return (
        routes.select?.() ??
        result({ skills: ['jong-skills:documentation', 'no-mistakes-rules:git-rules'] }, 0.01)
      )
    }
    if (prompt.includes('EVIDENCE prompt text')) {
      return (
        routes.evidence?.() ??
        result(
          {
            sources: [
              { name: 'aws', status: 'checked', queries: [{ command: 'aws logs x', result: '0' }] },
            ],
            findings: [{ id: 'F1', effect: 'contradicts', note: 'Never seen in logs.' }],
            claims: [],
          },
          0.5,
        )
      )
    }
    if (prompt.includes('VERIFIER prompt text')) {
      return (
        routes.verifier?.() ??
        result(
          {
            summary: 'One thing to fix.',
            pullRequestSummary: 'It adds a widget.',
            findings: [
              {
                pillar: 'rules',
                severity: 'high',
                title: 'Bad',
                body: 'b',
                path: 'a.ts',
                line: 3,
                side: 'RIGHT',
                sources: [0],
              },
            ],
            dropped: [{ index: 1, reason: 'Nit.' }],
          },
          1,
        )
      )
    }
    const name = prompt.includes('rules prompt text') ? 'rules' : 'correctness'
    if (routes.pillar !== undefined) return routes.pillar(name)
    const findings =
      name === 'rules'
        ? [{ severity: 'high', title: 'Bad', body: 'b', path: 'a.ts', line: 3 }]
        : [{ severity: 'low', title: 'Nit', body: 'n' }]
    return result({ findings }, 0.25)
  }
}

function setup(
  overrides: Partial<ReviewSteps> = {},
  plan: ReviewPlan = PLAN,
  after: (out: string) => void = () => undefined,
) {
  const out = mkdtempSync(join(tmpdir(), 'review-'))
  dirs.push(out)
  const calls: string[] = []
  const steps: ReviewSteps = {
    claim: vi.fn(async () => ({ claimed: true })),
    prepare: vi.fn(async () => {
      mkdirSync(join(out, 'diff'), { recursive: true })
      writeFileSync(join(out, 'diff', 'INDEX.md'), '- a.ts')
      mkdirSync(join(out, 'since'), { recursive: true })
      writeFileSync(join(out, 'since', 'INDEX.md'), '- since.ts')
      writeFileSync(join(out, 'diff.patch'), 'diff --git a/a.ts b/a.ts\n+full\n')
      writeFileSync(join(out, 'since.patch'), 'diff --git a/since.ts b/since.ts\n+newer\n')
      writeFileSync(join(out, 'context.json'), JSON.stringify({ title: 'Add widget' }))
      after(out)
      return { headSha: SHA, plan } as never
    }),
    skip: vi.fn(async (reason: string, headSha: string) =>
      calls.push(`skip ${reason} @${headSha}`),
    ),
    abort: vi.fn(async () => calls.push('abort')),
    preview: vi.fn(async () => ({
      verdict: 'Comment',
      reviews: [{ event: 'COMMENT', commit_id: SHA, body: 'Body.', comments: [] }],
    })) as never,
    plugins: vi.fn(async () => ({
      enabled: [{ id: 'jong-skills@m', version: '1' }],
      installs: [
        { name: 'jong-skills', installPath: fixture('plugins/skills') },
        { name: 'no-mistakes-rules', installPath: fixture('plugins/no-mistakes-rules') },
      ],
    })),
    evidence: vi.fn(async () => ({ sources: [], readGuide: async () => '' })),
    exec: claude(),
    references: fixture('references'),
    ...overrides,
  }
  return {
    out,
    steps,
    calls,
    options: { repo: 'acme/widgets', pr: 4, out, tree: '/tree', jobs: 2 },
  }
}

const readJson = (out: string, name: string) => JSON.parse(readFileSync(join(out, name), 'utf8'))

describe('runReview', () => {
  it('runs the whole pipeline and stops before posting', async () => {
    const { out, steps, calls, options } = setup()
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(true)
    expect(outcome.summary).toEqual({
      claimed: true,
      mode: 'full',
      verdict: 'Comment',
      findings: { blocking: 0, high: 1, medium: 0, low: 0 },
      costUsd: 1.51,
      report: join(out, 'report.md'),
      review: join(out, 'review.json'),
      headSha: SHA,
      fixedThreadIds: [],
    })
    expect(calls).toEqual([])
    for (const file of [
      'skills.json',
      'verifier.json',
      'review.json',
      'preview.md',
      'report.json',
      'report.md',
    ]) {
      expect(readFileSync(join(out, file), 'utf8').length).toBeGreaterThan(0)
    }
    expect(readJson(out, 'skills.json').selected).toEqual([
      'jong-skills:documentation',
      'no-mistakes-rules:git-rules',
    ])
    expect(readFileSync(join(out, 'preview.md'), 'utf8')).toContain('Body.')
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('## acme/widgets#4: Add widget')
  })

  it('writes a review.json that the post step accepts, with no report-only fields', async () => {
    const { out, steps, options } = setup()
    await runReview(steps, options)
    const raw = readJson(out, 'review.json')
    expect(Object.keys(raw).sort()).toEqual(['effort', 'findings', 'skipped', 'summary'])
    expect(raw.effort).toBe('high')
    const parsed = parseReviewInput(raw)
    expect(parsed.findings).toHaveLength(1)
    expect(parsed.skipped).toEqual(PLAN.skipped)
    expect(JSON.stringify(raw)).not.toContain('sources')
    expect(JSON.stringify(raw)).not.toContain('pullRequestSummary')
  })

  it('reads the since index and finds rule sources for a follow-up run', async () => {
    const { out, steps, options } = setup({}, { ...PLAN, mode: 'light', sinceSha: 'e'.repeat(40) })
    mkdirSync(join(out, 'rules'), { recursive: true })
    writeFileSync(join(out, 'rules', 'INDEX.md'), 'rules')
    const prompts: string[] = []
    const inner = claude()
    steps.exec = async (command, args, execOptions) => {
      prompts.push(args[1] as string)
      return inner(command, args, execOptions)
    }
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(true)
    expect(prompts[0]).toContain('- since.ts')
    expect(prompts[0]).toContain('+newer')
    expect(prompts[0]).not.toContain('+full')
    expect(prompts.some((prompt) => prompt.includes(`${out}/rules/INDEX.md`))).toBe(true)
  })

  it('returns early without preparing when the pull request is not claimed', async () => {
    let prepared = false
    const { steps, options } = setup({
      claim: vi.fn(async () => ({ claimed: false })),
      prepare: vi.fn(async () => {
        prepared = true
        return {} as never
      }),
    })
    const outcome = await runReview(steps, options)
    expect(outcome).toEqual({ ok: true, summary: { claimed: false } })
    expect(prepared).toBe(false)
  })

  it('closes a skip plan through skip, writes a skip report, and does not abort', async () => {
    const plan = { ...PLAN, mode: 'skip' as const, skipReason: 'Lockfile only.', pillars: [] }
    const { out, steps, calls, options } = setup({}, plan)
    const outcome = await runReview(steps, options)
    expect(calls).toEqual([`skip Lockfile only. @${SHA}`])
    expect(outcome.summary).toMatchObject({
      claimed: true,
      mode: 'skip',
      verdict: null,
      costUsd: 0,
      review: null,
    })
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('**Skipped:** Lockfile only.')
  })

  it('does not abort after skip closed the claim even if the report fails to write', async () => {
    const plan = { ...PLAN, mode: 'skip' as const, skipReason: 'Lockfile only.', pillars: [] }
    const { steps, calls, options } = setup({}, plan, (out) => mkdirSync(join(out, 'report.json')))
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(false)
    expect(calls).toEqual([`skip Lockfile only. @${SHA}`])
  })

  it('fails closed and aborts without requeue when every pillar fails', async () => {
    const { steps, calls, options } = setup({
      exec: claude({ pillar: () => 'not json' }),
    })
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(false)
    expect(outcome.summary.claimed).toBe(true)
    expect(String(outcome.summary.error)).toContain('Every pillar failed')
    expect(calls).toEqual(['abort'])
  })

  it('posts a failed pillar as skipped with a short reason and keeps the others', async () => {
    const { out, steps, options } = setup({
      exec: claude({
        verifier: () => result({ summary: 'Clean.', pullRequestSummary: 'p', findings: [] }, 1),
        pillar: (name) => {
          if (name === 'correctness') throw new Error('claude crashed\nstderr: secret detail')
          return result({ findings: [] }, 0.25)
        },
      }),
    })
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(true)
    const review = readJson(out, 'review.json')
    expect(review.skipped).toEqual([
      ...PLAN.skipped,
      { pillar: 'correctness', reason: 'The run failed twice: claude crashed' },
    ])
    expect(JSON.stringify(review)).not.toContain('secret detail')
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('Failed: claude crashed')
  })

  it('records an abort failure without hiding the original error', async () => {
    const { steps, options } = setup({
      abort: vi.fn(async () => {
        throw new Error('gh down')
      }),
      exec: claude({ verifier: () => 'not json' }),
    })
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(false)
    expect(outcome.summary).toMatchObject({
      claimed: true,
      error: 'Verifier run did not print JSON.',
      abortError: 'gh down',
    })
  })

  it('drops the claim when the output directory cannot be made', async () => {
    const { out, steps, calls, options } = setup()
    writeFileSync(join(out, 'file'), '')
    const outcome = await runReview(steps, { ...options, out: join(out, 'file') })
    expect(outcome.ok).toBe(false)
    expect(calls).toEqual(['abort'])
  })

  it('reports a non-Error failure as text', async () => {
    const { steps, calls, options } = setup({
      prepare: vi.fn(async () => {
        throw 'plain failure'
      }),
    })
    const outcome = await runReview(steps, options)
    expect(outcome.summary).toMatchObject({ error: 'plain failure' })
    expect(calls).toEqual(['abort'])
  })

  it('reports the fixed threads the context listed, for the caller to resolve', async () => {
    const context = { title: 'T', unresolved: [{ threadId: 'T1' }, { threadId: null }, null] }
    const verifier = () =>
      result(
        { summary: 's', pullRequestSummary: 'p', findings: [], fixedThreadIds: ['T1', 'X'] },
        1,
      )
    const { out, steps, options } = setup({ exec: claude({ verifier }) }, PLAN, (dir) =>
      writeFileSync(join(dir, 'context.json'), JSON.stringify(context)),
    )
    const outcome = await runReview(steps, options)
    expect(outcome.summary.fixedThreadIds).toEqual(['T1'])
    expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain('--thread T1`')
  })

  it('titles a pull request without a title', async () => {
    const { out, steps, options } = setup({}, PLAN, (dir) =>
      writeFileSync(join(dir, 'context.json'), '{}'),
    )
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(true)
    expect(readJson(out, 'report.json').title).toBe('(untitled)')
  })

  it('makes no evidence run and writes no evidence.json when no source is configured', async () => {
    const { out, steps, options } = setup()
    await runReview(steps, options)
    expect(readJson(out, 'report.json').evidence).toBeUndefined()
    expect(readFileSync(join(out, 'report.md'), 'utf8')).not.toContain('### Evidence')
    expect(() => readFileSync(join(out, 'evidence.json'))).toThrow()
  })

  describe('with an evidence source', () => {
    const source = {
      name: 'aws',
      description: 'Logs.',
      guide: { file: '/g.md' },
      commands: ['aws logs filter-log-events'],
      env: {},
    }
    const withEvidence = (routes: Routes = {}) =>
      setup({
        evidence: vi.fn(async () => ({ sources: [source], readGuide: async () => 'guide' })),
        exec: claude(routes),
      })

    it('runs after the verifier, annotates the finding, and adds the cost', async () => {
      const { out, steps, options } = withEvidence()
      const outcome = await runReview(steps, options)
      expect(outcome.ok).toBe(true)
      expect(outcome.summary.costUsd).toBe(2.01)
      const review = readJson(out, 'review.json')
      expect(review.findings[0].body).toBe('b\n\nEvidence (aws, contradicts): Never seen in logs.')
      expect(review.findings[0].severity).toBe('high')
      expect(readJson(out, 'evidence.json').sources[0].status).toBe('checked')
      expect(readJson(out, 'report.json').evidence.sources[0].name).toBe('aws')
      const markdown = readFileSync(join(out, 'report.md'), 'utf8')
      expect(markdown).toContain('### Evidence')
      expect(markdown).toContain('evidence $0.5000')
    })

    it('keeps the review when the evidence run fails, and says so in the report', async () => {
      const { out, steps, options } = withEvidence({ evidence: () => 'not json' })
      const outcome = await runReview(steps, options)
      expect(outcome.ok).toBe(true)
      expect(readJson(out, 'review.json').findings[0].body).toBe('b')
      expect(readFileSync(join(out, 'report.md'), 'utf8')).toContain(
        'Failed: Evidence run did not print JSON.',
      )
    })
  })

  it('runs no pillar and aborts when no rule skill is installed', async () => {
    const exec = vi.fn(claude())
    const { out, steps, calls, options } = setup({
      exec,
      plugins: vi.fn(async () => ({ enabled: [], installs: [] })),
    })
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(false)
    expect(outcome.summary.error).toBe(
      'Skill selection failed, so no review was run: No rule skills are installed.',
    )
    expect(readJson(out, 'skills.json').error).toBe('No rule skills are installed.')
    expect(exec).not.toHaveBeenCalled()
    expect(calls).toEqual(['abort'])
  })

  it('stops when the selection call fails twice', async () => {
    const select = vi.fn(() => 'not json')
    const { steps, calls, options } = setup({ exec: claude({ select }) })
    const outcome = await runReview(steps, options)
    expect(outcome.ok).toBe(false)
    expect(String(outcome.summary.error)).toContain('Skill selection failed, so no review was run')
    expect(select).toHaveBeenCalledTimes(2)
    expect(calls).toEqual(['abort'])
  })
})
