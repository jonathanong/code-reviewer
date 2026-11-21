import { describe, expect, it, vi } from 'vitest'

import type { Exec } from '../review/benchmark/exec.mts'
import { runStep, StepFailure, type StepRuntime } from './runner.mts'
import type { FailureClass, Harness, HarnessRun } from './types.mts'
import { HarnessRefusal } from './refusal.mts'
import { READ_ONLY } from './types.mts'

const RESULT = { structured: 1, skills: [], usage: {} as never, reportedUsage: null }

/** Two adapters that fail as told: the first with a named retry-after, the second never. */
const calls: string[] = []
const seen: HarnessRun[] = []
const failures: FailureClass[] = []
const fakes: Record<string, Harness> = {
  slow: {
    name: 'slow',
    async run(request) {
      seen.push(request)
      calls.push(`slow:${request.model}`)
      if (failures.length > 0) throw new Error('limited')
      return RESULT
    },
    describeFailure: (error) => ({ message: (error as Error).message, usage: null }),
    classifyFailure: () => failures.shift() ?? { kind: 'other' },
  },
  steady: {
    name: 'steady',
    async run(request) {
      seen.push(request)
      calls.push(`steady:${request.model}`)
      return RESULT
    },
    describeFailure: () => ({ message: '', usage: null }),
    classifyFailure: () => ({ kind: 'other' }),
  },
}

vi.mock('./registry.mts', () => ({
  HARNESS_NAMES: ['slow', 'steady', 'picky', 'strict'],
  harnessNamed: (name: string) => fakes[name],
}))

fakes.picky = {
  ...(fakes.steady as Harness),
  name: 'picky',
  async run(request) {
    calls.push(`picky:${request.model}`)
    throw new HarnessRefusal('picky cannot confine: shell prefixes (Step)')
  },
  describeFailure: (error) => ({ message: (error as Error).message, usage: null }),
}

/** Refuses any shell grant before it starts, the way the Grok and OpenCode adapters do. */
fakes.strict = {
  ...(fakes.steady as Harness),
  name: 'strict',
  assertCan(request) {
    if (request.can.shell.length > 0) throw new HarnessRefusal('strict cannot confine shell')
  },
}

const exec: Exec = async () => ''
const REQUEST = { prompt: 'P', label: 'Step', maxTurns: 2, schema: {}, can: READ_ONLY }

function runtime(maxWaitSeconds: number) {
  const sleeps: number[] = []
  let time = 0
  const clock: StepRuntime = {
    maxWaitSeconds,
    sleep: async (ms) => {
      sleeps.push(ms)
      time += ms
    },
    now: () => time,
  }
  return { clock, sleeps }
}

describe('runStep across harnesses', () => {
  it('waits the retry-after a harness names, then falls back to another harness', async () => {
    calls.length = 0
    failures.splice(0, failures.length, { kind: 'rate_limited', retryAfterSeconds: 7 })
    const { clock, sleeps } = runtime(7)
    const candidates = [
      { harness: 'slow', model: 'x' },
      { harness: 'steady', model: 'y' },
    ]
    const first = await runStep(REQUEST, candidates, exec, clock)
    expect(sleeps).toEqual([7_000])
    expect(first.ran).toEqual({ harness: 'slow', model: 'x', waitedMs: 7_000 })

    failures.splice(0, failures.length, { kind: 'rate_limited', retryAfterSeconds: 8 })
    const second = await runStep(REQUEST, candidates, exec, clock)
    expect(sleeps).toEqual([7_000])
    expect(second.ran).toEqual({ harness: 'steady', model: 'y', waitedMs: 0 })
    expect(calls).toEqual(['slow:x', 'slow:x', 'slow:x', 'steady:y'])
  })

  it('adds the analysis grant and section only when the harness accepts a shell grant', async () => {
    seen.length = 0
    failures.length = 0
    const analysis = { commands: ['tool query'], section: 'SECTION' }
    const request = { ...REQUEST, can: { ...READ_ONLY, shell: [] }, analysis }
    const { clock } = runtime(0)
    await runStep(request, [{ harness: 'slow', model: 'x' }], exec, clock)
    await runStep(request, [{ harness: 'strict', model: 'y' }], exec, clock)
    const [confined, unconfined] = seen as [HarnessRun, HarnessRun]
    expect(confined.can.shell).toEqual(['tool query'])
    expect(confined.prompt).toBe('P\n\nSECTION')
    expect(unconfined.can.shell).toEqual([])
    expect(unconfined.prompt).toBe('P')
    expect('analysis' in confined || 'analysis' in unconfined).toBe(false)
  })
})

describe('runStep with a candidate that accepts reads outside the checkout', () => {
  it('hands the acceptance to the adapter for that candidate only', async () => {
    seen.length = 0
    failures.length = 0
    const { clock } = runtime(0)
    await runStep(
      REQUEST,
      [{ harness: 'slow', model: 'x', readsOutsideCheckout: true }],
      exec,
      clock,
    )
    await runStep(REQUEST, [{ harness: 'slow', model: 'x' }], exec, clock)
    const [accepted, plain] = seen as [HarnessRun, HarnessRun]
    expect(accepted.readsOutsideCheckout).toBe(true)
    expect('readsOutsideCheckout' in plain).toBe(false)
  })
})

describe('runStep when an adapter refuses the step', () => {
  it('moves to the next candidate at once, without waiting', async () => {
    calls.length = 0
    const { clock, sleeps } = runtime(60)
    const run = await runStep(
      REQUEST,
      [
        { harness: 'picky', model: 'x' },
        { harness: 'steady', model: 'y' },
      ],
      exec,
      clock,
    )
    expect(calls).toEqual(['picky:x', 'steady:y'])
    expect(sleeps).toEqual([])
    expect(run.ran).toEqual({ harness: 'steady', model: 'y', waitedMs: 0 })
  })

  it('fails the step when the refusing candidate is the last', async () => {
    calls.length = 0
    const { clock } = runtime(60)
    await expect(
      runStep(REQUEST, [{ harness: 'picky', model: 'x' }], exec, clock),
    ).rejects.toBeInstanceOf(StepFailure)
  })
})
