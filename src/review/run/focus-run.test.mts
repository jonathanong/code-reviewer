import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { Pillar } from '../pillar-name.mts'
import { resolveModelPlan } from '../models.mts'
import { runFocus } from './focus-run.mts'
import { runPillarsAndFocus } from './review-focus.mts'
import type { PillarsInput } from './pillars.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const answer = (structured: unknown) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.5,
    num_turns: 2,
    structured_output: structured,
  })
const POINTS = [{ point: 'the loop is bounded', origin: 'requester' as const }]
const HOLDS = {
  points: [{ index: 0, status: 'holds', basis: 'Yes.', path: 'a.ts', line: 2 }],
  findings: [],
}

function setup(overrides: Partial<PillarsInput> = {}) {
  const out = mkdtempSync(join(tmpdir(), 'focus-run-'))
  dirs.push(out)
  const input: PillarsInput = {
    pillars: [{ pillar: 'rules', model: 'sonnet' }],
    tree: '/tree',
    run: { out, sinceSha: null, hasRules: false },
    mode: 'full',
    jobs: 1,
    contract: 'CONTRACT',
    readPillar: (pillar: Pillar) => `PILLAR ${pillar}`,
    skills: [],
    exec: vi.fn(),
    ...overrides,
  }
  return input
}

const flag = (call: unknown, name: string) => {
  const args = (call as [string, string[]])[1]
  return args[args.indexOf(name) + 1]
}

describe('runFocus', () => {
  it('runs one step for all points with the read-only tools of a pillar and the settings', async () => {
    const exec = vi.fn(async () => answer(HOLDS))
    const input = setup({ exec, settings: { enabledPlugins: {} }, mode: 'light' })
    const { result, answers } = await runFocus({ ...input, points: POINTS })
    expect(exec).toHaveBeenCalledOnce()
    expect(result).toMatchObject({ pillar: 'focus', model: 'sonnet', findings: [] })
    expect(answers).toEqual([
      {
        point: POINTS[0]!.point,
        origin: 'requester',
        status: 'holds',
        basis: 'Yes.',
        path: 'a.ts',
        line: 2,
      },
    ])
    const call = exec.mock.calls[0]
    expect(flag(call, '--tools')).toBe('Read,Grep,Glob,Agent,Skill')
    expect(flag(call, '--add-dir')).toBe(input.run.out)
    expect((call as unknown as [string, string[]])[1]).toContain('--settings')
  })

  it('runs on the focus model when one is set, then the pillars model', async () => {
    const exec = vi.fn(async () => answer(HOLDS))
    const own = resolveModelPlan(undefined, { focus: [{ harness: 'claude', model: 'opus' }] })
    await runFocus({ ...setup({ exec, models: { plan: own } }), points: POINTS })
    expect(flag(exec.mock.calls[0], '--model')).toBe('opus')
    exec.mockClear()
    const shared = resolveModelPlan(undefined, { pillars: [{ harness: 'claude', model: 'haiku' }] })
    await runFocus({ ...setup({ exec, models: { plan: shared } }), points: POINTS })
    expect(flag(exec.mock.calls[0], '--model')).toBe('haiku')
  })

  it('retries once, and a step that fails twice leaves every point not checked', async () => {
    const exec = vi.fn(async () => 'not json')
    const { result, answers } = await runFocus({
      ...setup({ exec }),
      points: [
        { point: 'a', origin: 'requester' },
        { point: 'b', origin: 'target:g' },
      ],
    })
    expect(exec).toHaveBeenCalledTimes(4)
    expect(result.error).toBeDefined()
    expect(result.failedAttempts).toHaveLength(4)
    expect(answers.map((entry) => entry.status)).toEqual(['not_checked', 'not_checked'])
  })

  it('gives each target point its own call and keeps the answers in the order asked', async () => {
    const reply = (basis: string, findings: unknown[] = []) =>
      answer({ points: [{ index: 0, status: 'holds', basis, path: 'a.ts', line: 1 }], findings })
    const finding = { severity: 'low', title: 'T', body: 'B' }
    const exec = vi.fn<Exec>(async (...call) => {
      const text = JSON.stringify(call)
      if (text.includes('TARGET ONE')) return reply('one', [finding])
      if (text.includes('TARGET TWO')) return reply('two')
      return answer({
        points: [
          { index: 0, status: 'holds', basis: 'first', path: 'a.ts', line: 1 },
          { index: 1, status: 'holds', basis: 'second', path: 'a.ts', line: 1 },
        ],
        findings: [],
      })
    })
    const { result, answers } = await runFocus({
      ...setup({ exec }),
      points: [
        { point: 'TARGET ONE', origin: 'target:one' },
        { point: 'REQUESTER A', origin: 'requester' },
        { point: 'TARGET TWO', origin: 'target:two' },
        { point: 'REQUESTER B', origin: 'requester' },
      ],
    })
    expect(exec).toHaveBeenCalledTimes(3)
    expect(answers.map((entry) => entry.basis)).toEqual(['one', 'first', 'two', 'second'])
    expect(answers.map((entry) => entry.origin)).toEqual([
      'target:one',
      'requester',
      'target:two',
      'requester',
    ])
    expect(result.error).toBeUndefined()
    expect(result.findings).toHaveLength(1)
    expect(result.usage?.costUsd).toBeCloseTo(1.5)
  })

  it('keeps the answers of the calls that worked when one target call fails twice', async () => {
    const exec = vi.fn<Exec>(async (...call) =>
      JSON.stringify(call).includes('TARGET ONE') ? 'not json' : answer(HOLDS),
    )
    const { result, answers } = await runFocus({
      ...setup({ exec }),
      points: [
        { point: 'TARGET ONE', origin: 'target:one' },
        { point: 'TARGET TWO', origin: 'target:two' },
      ],
    })
    expect(exec).toHaveBeenCalledTimes(3)
    expect(result.error).toBeUndefined()
    expect(result.failedAttempts).toHaveLength(2)
    expect(answers.map((entry) => entry.status)).toEqual(['not_checked', 'holds'])
  })

  it('answers after a retry that works', async () => {
    const exec = vi
      .fn<Exec>()
      .mockResolvedValueOnce('not json')
      .mockResolvedValueOnce(answer(HOLDS))
    const { result, answers } = await runFocus({ ...setup({ exec }), points: POINTS })
    expect(result.failedAttempts).toHaveLength(1)
    expect(answers[0]?.status).toBe('holds')
  })
})

describe('runPillarsAndFocus', () => {
  it('runs the step even when the plan dispatches no pillar', async () => {
    const exec = vi.fn(async () => answer(HOLDS))
    const out = await runPillarsAndFocus(setup({ exec, pillars: [] }), [POINTS[0]!.point])
    expect(exec).toHaveBeenCalledOnce()
    expect(out.results).toEqual([])
    expect(out.judged.map((result) => result.pillar)).toEqual(['focus'])
    expect(out.extraPillars).toEqual(['focus'])
  })

  it('runs no extra step without points', async () => {
    const exec = vi.fn(async () => answer({ findings: [] }))
    const out = await runPillarsAndFocus(setup({ exec }), undefined)
    expect(exec).toHaveBeenCalledOnce()
    expect(out.focus).toBeUndefined()
    expect(out.judged).toBe(out.results)
    expect(out.extraPillars).toEqual([])
  })
})
