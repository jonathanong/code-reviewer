import { describe, expect, it, vi } from 'vitest'

import type { Exec } from '../review/benchmark/exec.mts'
import { runStep, type StepRuntime } from './runner.mts'
import type { FailureClass, Harness } from './types.mts'
import { READ_ONLY } from './types.mts'

const RESULT = { structured: 1, skills: [], usage: {} as never, reportedUsage: null }

/** Two adapters that fail as told: the first with a named retry-after, the second never. */
const calls: string[] = []
const failures: FailureClass[] = []
const fakes: Record<string, Harness> = {
  slow: {
    name: 'slow',
    async run(request) {
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
      calls.push(`steady:${request.model}`)
      return RESULT
    },
    describeFailure: () => ({ message: '', usage: null }),
    classifyFailure: () => ({ kind: 'other' }),
  },
}

vi.mock('./registry.mts', () => ({
  HARNESS_NAMES: ['slow', 'steady'],
  harnessNamed: (name: string) => fakes[name],
}))

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
})
