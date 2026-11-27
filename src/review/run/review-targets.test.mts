import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import { focusSection } from '../focus.mts'
import type { ReviewPlan } from '../plan.mts'
import { renderHeader } from '../render.mts'
import type { TargetSettings } from '../targets-settings.mts'
import { combineFocusPoints, pickTargets } from './review-focus.mts'
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
  pillars: [{ pillar: 'correctness', model: 'sonnet' }],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const TARGET_WHEN =
  'The change adds a lock, compare-and-set, retry on conflict, or other guard against two runs of the same code overlapping.'
const TARGET_POINT =
  'The change adds a guard against two runs of the same code overlapping. Find every caller of the guarded code and how each is scheduled or enqueued, then look for what already serialises them: a queue ordering or group key with concurrency 1, a fixed job id or dedupe key, a single schedule, a unique constraint, an existing lock. Claim to test: two runs can overlap, so the guard is needed.'

const result = (structured: unknown) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.1,
    num_turns: 1,
    structured_output: structured,
  })

function referencesWithTarget(): string {
  const dir = mkdtempSync(join(tmpdir(), 'refs-targets-'))
  dirs.push(dir)
  cpSync(fixture('references'), dir, { recursive: true })
  mkdirSync(join(dir, 'targets'), { recursive: true })
  writeFileSync(
    join(dir, 'targets', 'unneeded-concurrency-guard.md'),
    `---\nname: unneeded-concurrency-guard\nwhen: ${TARGET_WHEN}\n---\n\n${TARGET_POINT}\n`,
  )
  return dir
}

type Call = { prompt: string; schema: string; tools: string }
type Scenario = {
  selectedTargets?: unknown
  failSelection?: boolean
  focusStatus?: 'holds' | 'does_not_hold' | 'not_checked'
  requesterPoints?: string[]
  targetSettings?: TargetSettings
  rulePlugins?: string[]
  plan?: ReviewPlan
}

const isFocusCall = (call: Call) => call.prompt.includes('Check every point against the code')

async function runScenario(scenario: Scenario) {
  const out = mkdtempSync(join(tmpdir(), 'review-targets-'))
  dirs.push(out)
  const references = referencesWithTarget()
  const calls: Call[] = []
  const skipped: string[] = []
  const exec: Exec = async (_command, args) => {
    const prompt = args[1] as string
    const schema = args[args.indexOf('--json-schema') + 1] as string
    const tools = args[args.indexOf('--tools') + 1] as string
    calls.push({ prompt, schema, tools })
    if (tools === '') {
      if (scenario.failSelection) return 'not json'
      return result({
        skills: [],
        ...(scenario.selectedTargets === undefined ? {} : { targets: scenario.selectedTargets }),
      })
    }
    if (prompt.includes('Check every point against the code')) {
      const status = scenario.focusStatus ?? 'holds'
      const reqCount = scenario.requesterPoints?.length ?? 0
      const points = [
        ...Array.from({ length: reqCount }, (_, index) => ({
          index,
          status: 'holds',
          basis: 'Requester point holds.',
          path: 'a.ts',
          line: 1,
        })),
        {
          index: reqCount,
          status,
          basis:
            status === 'does_not_hold'
              ? 'Ordering key with concurrency 1 serialises runs.'
              : 'Runs can overlap.',
          ...(status === 'not_checked' ? {} : { path: 'a.ts', line: 5 }),
        },
      ]
      return result({
        points,
        findings:
          status === 'does_not_hold'
            ? [
                {
                  severity: 'medium',
                  title: 'Unneeded compare-and-set guard',
                  body: 'Queue already runs at concurrency 1.',
                  path: 'a.ts',
                  line: 5,
                },
              ]
            : [],
      })
    }
    if (prompt.includes('VERIFIER prompt text')) {
      return result({
        summary: 'S.',
        pullRequestSummary: 'P.',
        findings: prompt.includes('Unneeded compare-and-set guard')
          ? [
              {
                pillar: 'focus',
                severity: 'medium',
                title: 'Unneeded compare-and-set guard',
                body: 'Queue already runs at concurrency 1.',
                path: 'a.ts',
                line: 5,
                sources: [0],
              },
            ]
          : [],
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
      return { headSha: 'd'.repeat(40), plan: scenario.plan ?? PLAN }
    },
    skip: async (reason: string) => void skipped.push(reason),
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Approve', reviews: [] }),
    plugins: async () => ({
      enabled: [],
      installs: [{ name: 'ratchet-workflows', installPath: fixture('plugins/skills') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: scenario.rulePlugins ?? ['ratchet-workflows'],
    targets: scenario.targetSettings,
    exec,
    references,
  } as unknown as ReviewSteps
  const outcome = await runReview(steps, {
    repo: 'acme/widgets',
    pr: 4,
    out,
    tree: '/tree',
    jobs: 1,
    ...(scenario.requesterPoints === undefined ? {} : { focus: scenario.requesterPoints }),
  })
  const review =
    outcome.summary.review === null
      ? null
      : JSON.parse(readFileSync(join(out, 'review.json'), 'utf8'))
  const report = JSON.parse(readFileSync(join(out, 'report.json'), 'utf8'))
  const reportMd = readFileSync(join(out, 'report.md'), 'utf8')
  return { outcome, out, calls, review, report, reportMd, skipped }
}

const RUN_DIR = /review-targets-[A-Za-z0-9]+/gu
const REFS_DIR = /refs-targets-[A-Za-z0-9]+/gu
const norm = (text: string) => text.replace(RUN_DIR, 'RUN').replace(REFS_DIR, 'REFS')

describe('targeted checks raised by the reviewer', () => {
  it('offers only name and when to selection, uses target framing in focus and verifier, and posts only findings', async () => {
    const run = await runScenario({
      selectedTargets: ['unneeded-concurrency-guard', 'unknown-ignored'],
      focusStatus: 'does_not_hold',
    })
    expect(run.outcome.ok).toBe(true)
    const selectCall = run.calls.find((c) => c.tools === '')!
    expect(selectCall.prompt).toContain(`- unneeded-concurrency-guard: ${TARGET_WHEN}`)
    expect(selectCall.prompt).not.toContain(TARGET_POINT)
    expect(JSON.parse(selectCall.schema).properties).toHaveProperty('targets')

    const focusCall = run.calls.find(isFocusCall)!
    expect(focusCall.prompt).toContain('# Targeted checks')
    expect(focusCall.prompt).toContain(TARGET_POINT)
    expect(focusCall.prompt).not.toContain('written by the party being reviewed')

    const verifierCall = run.calls.find((c) => c.prompt.includes('VERIFIER prompt text'))!
    expect(verifierCall.prompt).toContain('## Focus checks')
    expect(verifierCall.prompt).toContain('"origin": "target:unneeded-concurrency-guard"')

    expect(run.review.findings).toEqual([
      expect.objectContaining({ pillar: 'focus', title: 'Unneeded compare-and-set guard' }),
    ])
    expect(run.review.focus).toEqual([
      {
        point: TARGET_POINT,
        origin: 'target:unneeded-concurrency-guard',
        status: 'does_not_hold',
        basis: 'Ordering key with concurrency 1 serialises runs.',
        path: 'a.ts',
        line: 5,
      },
    ])
    expect(focusSection(run.review.focus)).toEqual([])
    const header = renderHeader(run.review, 'd'.repeat(40))
    expect(header).toContain('Unneeded compare-and-set guard')
    expect(header).not.toContain('Requested checks')
    expect(run.report.focus).toEqual(run.review.focus)
    expect(run.reportMd).toContain('Targets selected: unneeded-concurrency-guard')
    expect(run.reportMd).toContain('### Focus checks')
    expect(run.reportMd).toContain('[target:unneeded-concurrency-guard] **does_not_hold**')
  })

  it('leaves no trace in the posted review when a target holds or is not_checked, while recording it in review.json and report', async () => {
    for (const focusStatus of ['holds', 'not_checked'] as const) {
      const run = await runScenario({
        selectedTargets: ['unneeded-concurrency-guard'],
        focusStatus,
      })
      expect(run.review.findings).toEqual([])
      expect(run.review.focus).toEqual([
        expect.objectContaining({
          origin: 'target:unneeded-concurrency-guard',
          status: focusStatus,
        }),
      ])
      const header = renderHeader(run.review, 'd'.repeat(40))
      expect(header).not.toContain('Requested checks')
      expect(header).not.toContain('unneeded-concurrency-guard')
      expect(run.reportMd).toContain(`[target:unneeded-concurrency-guard] **${focusStatus}**`)
    }
  })

  it('runs requester points in one focus call and each selected target in its own, listing only requester points in Requested checks', async () => {
    const run = await runScenario({
      requesterPoints: ['the retry loop is bounded'],
      selectedTargets: ['unneeded-concurrency-guard'],
      focusStatus: 'holds',
    })
    const focusCalls = run.calls.filter(isFocusCall)
    expect(focusCalls).toHaveLength(2)
    const prompts = focusCalls.map((call) => call.prompt)
    expect(prompts.filter((prompt) => prompt.includes('# Requested checks'))).toHaveLength(1)
    expect(prompts.filter((prompt) => prompt.includes('# Targeted checks'))).toHaveLength(1)
    expect(prompts.some((prompt) => prompt.includes('# Focus checks'))).toBe(false)
    expect(run.review.focus).toEqual([
      expect.objectContaining({ origin: 'requester', point: 'the retry loop is bounded' }),
      expect.objectContaining({ origin: 'target:unneeded-concurrency-guard', point: TARGET_POINT }),
    ])
    const [block] = focusSection(run.review.focus)
    expect(block).toContain('Requested checks: 1 ok')
    expect(block).toContain('the retry loop is bounded')
    expect(block).not.toContain(TARGET_POINT)
  })

  it('keeps every prompt and schema after selection byte-identical when no target is selected and no focus file is given', async () => {
    const noneSelected = await runScenario({ selectedTargets: [] })
    const allDisabled = await runScenario({ targetSettings: { disabled: 'all' } })
    const afterSelect = (calls: Call[]) =>
      calls.filter((c) => c.tools !== '').map((c) => ({ prompt: norm(c.prompt), schema: c.schema }))
    expect(noneSelected.calls.some(isFocusCall)).toBe(false)
    expect(afterSelect(noneSelected.calls)).toEqual(afterSelect(allDisabled.calls))
    expect(noneSelected.review.focus).toBeUndefined()
    expect(noneSelected.report.focus).toBeUndefined()
  })

  it('selects targets when rulePlugins is empty, and degrades cleanly if that target-only call fails', async () => {
    const picked = await runScenario({
      rulePlugins: [],
      selectedTargets: ['unneeded-concurrency-guard'],
      focusStatus: 'holds',
    })
    expect(picked.outcome.ok).toBe(true)
    const selectCall = picked.calls.find((c) => c.tools === '')!
    expect(selectCall.prompt).toContain('## Targeted checks')
    expect(selectCall.prompt).not.toContain('## Installed rule skills')
    expect(picked.calls.some(isFocusCall)).toBe(true)

    const failed = await runScenario({ rulePlugins: [], failSelection: true })
    expect(failed.outcome.ok).toBe(true)
    expect(failed.calls.some(isFocusCall)).toBe(false)
    expect(failed.review.focus).toBeUndefined()
  })

  it('never offers or runs targets in light or skipped reviews, while keeping requester points in light reviews', async () => {
    const light: ReviewPlan = { ...PLAN, mode: 'light', effort: 'low' }
    const lightNoReq = await runScenario({
      plan: light,
      selectedTargets: ['unneeded-concurrency-guard'],
    })
    expect(lightNoReq.calls.find((c) => c.tools === '')?.prompt).not.toContain('## Targeted checks')
    expect(lightNoReq.calls.some(isFocusCall)).toBe(false)

    const lightWithReq = await runScenario({
      plan: light,
      requesterPoints: ['keep light requester check'],
      selectedTargets: ['unneeded-concurrency-guard'],
    })
    const focusCall = lightWithReq.calls.find(isFocusCall)!
    expect(focusCall.prompt).toContain('# Requested checks')
    expect(focusCall.prompt).not.toContain(TARGET_POINT)
    expect(lightWithReq.review.focus).toEqual([
      expect.objectContaining({ origin: 'requester', point: 'keep light requester check' }),
    ])

    const skippedReview = await runScenario({
      plan: { ...PLAN, mode: 'skip', skipReason: 'Lockfile only.', pillars: [] },
    })
    expect(skippedReview.calls).toEqual([])
    expect(skippedReview.skipped).toEqual(['Lockfile only.'])
  })

  it('records targets dropped by the 20-point cap in report.json and report.md', async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `req ${i}`)
    const run = await runScenario({
      requesterPoints: twenty,
      selectedTargets: ['unneeded-concurrency-guard'],
      focusStatus: 'holds',
    })
    expect(run.report.droppedTargets).toEqual(['unneeded-concurrency-guard'])
    expect(run.reportMd).toContain(
      'Targets dropped by the 20-point cap: unneeded-concurrency-guard.',
    )
    expect(run.calls.find(isFocusCall)?.prompt).not.toContain(TARGET_POINT)

    const targets = [
      { name: 'first', when: 'W1', point: 'T1' },
      { name: 'second', when: 'W2', point: 'T2' },
    ]
    const combined = combineFocusPoints(twenty.slice(0, 19), targets)
    expect(combined.points).toHaveLength(20)
    expect(combined.points[19]).toEqual({ point: 'T1', origin: 'target:first' })
    expect(combined.droppedTargets).toEqual(['second'])
    expect(pickTargets(targets, ['missing', 'second'])).toEqual([targets[1]])
    expect(pickTargets(targets, undefined)).toEqual([])
  })

  it('degrades cleanly when selection omits targets', async () => {
    const omitted = await runScenario({ selectedTargets: undefined })
    expect(omitted.outcome.ok).toBe(true)
    expect(omitted.calls.some(isFocusCall)).toBe(false)
  })
})
