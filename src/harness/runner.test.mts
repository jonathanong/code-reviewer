import { describe, expect, it } from 'vitest'

import { ExecError, type Exec } from '../review/benchmark/exec.mts'
import {
  StepFailure,
  describeStepFailure,
  realRuntime,
  runFixedModel,
  runStep,
  type StepRuntime,
} from './runner.mts'
import { READ_ONLY } from './types.mts'

const REQUEST = { prompt: 'P', label: 'Step', maxTurns: 2, schema: {}, can: READ_ONLY }
const OK = JSON.stringify({ type: 'result', structured_output: { ok: true } })

const apiError = (status: number) =>
  new ExecError(
    `claude exited with 1`,
    1,
    JSON.stringify({ type: 'result', is_error: true, api_error_status: status }),
    undefined,
  )

/** An exec that fails per model with the queued errors, then succeeds; it records each model it saw. */
function fakeExec(failures: Record<string, Error[]>) {
  const seen: string[] = []
  const exec: Exec = async (_command, args) => {
    const model = args[args.indexOf('--model') + 1] as string
    seen.push(model)
    const next = failures[model]?.shift()
    if (next !== undefined) throw next
    return OK
  }
  return { exec, seen }
}

/** A clock that moves only when a sleep says so. */
function fakeRuntime(maxWaitSeconds: number) {
  const sleeps: number[] = []
  let time = 1_000
  const runtime: StepRuntime = {
    maxWaitSeconds,
    sleep: async (ms) => {
      sleeps.push(ms)
      time += ms
    },
    now: () => time,
  }
  return { runtime, sleeps }
}

const A = { harness: 'claude', model: 'a' }
const B = { harness: 'claude', model: 'b' }

describe('runStep', () => {
  it('runs the first candidate and records it with no wait', async () => {
    const { exec, seen } = fakeExec({})
    const { runtime, sleeps } = fakeRuntime(600)
    const run = await runStep(REQUEST, [A, B], exec, runtime)
    expect(run.ran).toEqual({ harness: 'claude', model: 'a', waitedMs: 0 })
    expect(run.structured).toEqual({ ok: true })
    expect(seen).toEqual(['a'])
    expect(sleeps).toEqual([])
  })

  it('waits out a rate limit with a doubling, capped backoff and retries the same candidate', async () => {
    const limited = Array.from({ length: 6 }, () => apiError(429))
    const { exec, seen } = fakeExec({ a: limited })
    const { runtime, sleeps } = fakeRuntime(600)
    const run = await runStep(REQUEST, [A, B], exec, runtime)
    expect(sleeps).toEqual([5_000, 10_000, 20_000, 40_000, 60_000, 60_000])
    expect(seen).toEqual(Array(7).fill('a'))
    expect(run.ran).toEqual({ harness: 'claude', model: 'a', waitedMs: 195_000 })
  })

  it('treats overload like a rate limit', async () => {
    const { exec, seen } = fakeExec({ a: [apiError(529)] })
    const { runtime, sleeps } = fakeRuntime(600)
    await runStep(REQUEST, [A], exec, runtime)
    expect(sleeps).toEqual([5_000])
    expect(seen).toEqual(['a', 'a'])
  })

  it('moves to the next candidate once the wait budget is spent, keeping the time already waited', async () => {
    const { exec, seen } = fakeExec({ a: Array.from({ length: 9 }, () => apiError(429)) })
    const { runtime, sleeps } = fakeRuntime(20)
    const run = await runStep(REQUEST, [A, B], exec, runtime)
    expect(sleeps).toEqual([5_000, 10_000])
    expect(seen).toEqual(['a', 'a', 'a', 'b'])
    expect(run.ran).toEqual({ harness: 'claude', model: 'b', waitedMs: 15_000 })
  })

  it('moves on at once with no budget at all', async () => {
    const { exec, seen } = fakeExec({ a: [apiError(429)] })
    const { runtime, sleeps } = fakeRuntime(0)
    const run = await runStep(REQUEST, [A, B], exec, runtime)
    expect(sleeps).toEqual([])
    expect(seen).toEqual(['a', 'b'])
    expect(run.ran.model).toBe('b')
  })

  it('fails like a failed step when every candidate is exhausted', async () => {
    const { exec } = fakeExec({ a: [apiError(429)], b: [apiError(529)] })
    const { runtime } = fakeRuntime(0)
    const failure = await runStep(REQUEST, [A, B], exec, runtime).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(StepFailure)
    expect((failure as StepFailure).ran).toEqual({ harness: 'claude', model: 'b', waitedMs: 0 })
    expect((failure as StepFailure).message).toContain('claude exited with 1')
    expect((failure as StepFailure).cause).toBeInstanceOf(ExecError)
  })

  it('moves an auth failure to the next candidate without waiting', async () => {
    const { exec, seen } = fakeExec({ a: [apiError(401)] })
    const { runtime, sleeps } = fakeRuntime(600)
    const run = await runStep(REQUEST, [A, B], exec, runtime)
    expect(seen).toEqual(['a', 'b'])
    expect(sleeps).toEqual([])
    expect(run.ran.model).toBe('b')
  })

  it('fails an auth failure on the last candidate', async () => {
    const { exec } = fakeExec({ a: [apiError(401)] })
    await expect(runStep(REQUEST, [A], exec, fakeRuntime(600).runtime)).rejects.toBeInstanceOf(
      StepFailure,
    )
  })

  it('never retries or falls back on a failure it does not recognize', async () => {
    const { exec, seen } = fakeExec({
      a: [apiError(500)],
      b: [],
    })
    const { runtime, sleeps } = fakeRuntime(600)
    const failure = await runStep(REQUEST, [A, B], exec, runtime).catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(StepFailure)
    expect(seen).toEqual(['a'])
    expect(sleeps).toEqual([])
  })

  it('carries what a failed run still reported', async () => {
    const usage = { type: 'result', is_error: true, api_error_status: 500, total_cost_usd: 0.5 }
    const { exec } = fakeExec({
      a: [new ExecError('claude exited with 1', 1, JSON.stringify(usage), undefined)],
    })
    const failure = (await runStep(REQUEST, [A], exec, fakeRuntime(0).runtime).catch(
      (error: unknown) => error,
    )) as StepFailure
    expect(failure.usage?.costUsd).toBe(0.5)
  })

  it('refuses a step with no candidate', async () => {
    const { exec } = fakeExec({})
    await expect(runStep(REQUEST, [], exec, fakeRuntime(0).runtime)).rejects.toThrow(
      'at least one model candidate',
    )
  })
})

describe('runFixedModel', () => {
  it('runs the request on its own model with claude', async () => {
    const { exec, seen } = fakeExec({})
    const run = await runFixedModel({ ...REQUEST, model: 'opus' }, exec)
    expect(seen).toEqual(['opus'])
    expect(run.structured).toEqual({ ok: true })
  })
})

describe('describeStepFailure', () => {
  it('describes a step failure by its own record', () => {
    const ran = { harness: 'claude', model: 'a', waitedMs: 3 }
    expect(describeStepFailure(new StepFailure('m', null, ran, undefined))).toEqual({
      message: 'm',
      usage: null,
      ran,
    })
  })

  it('describes any other error as claude does', () => {
    expect(describeStepFailure(new Error('boom'))).toEqual({ message: 'boom', usage: null })
  })
})

describe('realRuntime', () => {
  it('sleeps for real and reads the real clock', async () => {
    const runtime = realRuntime(7)
    expect(runtime.maxWaitSeconds).toBe(7)
    const before = runtime.now()
    await runtime.sleep(1)
    expect(runtime.now()).toBeGreaterThanOrEqual(before)
  })
})
