import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { ReviewError } from '../review/finding.mts'
import { harness } from './agy.mts'
import { NO_TOOLS, READ_ONLY, type HarnessRun } from './types.mts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const request = (overrides: Partial<HarnessRun> = {}): HarnessRun => ({
  prompt: 'P',
  label: 'Step',
  model: 'm1',
  maxTurns: 4,
  schema: { type: 'object' },
  can: READ_ONLY,
  readsOutsideCheckout: true,
  ...overrides,
})
const run = (stdout: string, overrides: Partial<HarnessRun> = {}) =>
  harness.run(
    request(overrides),
    vi.fn(async () => stdout),
  )
const okExec = () =>
  vi.fn(async (_c: string, _a: string[], _o?: object) => fixture('agy-synthetic-ok.json'))

const BASE = [
  '-p',
  'P',
  '--model',
  'm1',
  '--output-format',
  'json',
  '--json-schema',
  '{"type":"object"}',
  '--mode',
  'plan',
  '--sandbox',
  '--disable-slash-commands',
]

describe('agy harness run', () => {
  it('runs a read-only step with exactly these arguments', async () => {
    const exec = okExec()
    await harness.run(request(), exec)
    expect(exec.mock.calls[0]).toStrictEqual(['agy', BASE, {}])
  })

  it('passes effort, add-dirs, cwd, timeout and env, and never a permissive flag', async () => {
    const exec = okExec()
    await harness.run(
      request({ effort: 'xhigh', addDirs: ['/a', '/b'], cwd: '/t', timeoutMs: 5, env: { K: 'v' } }),
      exec,
    )
    expect(exec.mock.calls[0]).toStrictEqual([
      'agy',
      [...BASE, '--effort', 'xhigh', '--add-dir', '/a', '--add-dir', '/b'],
      { cwd: '/t', timeoutMs: 5, env: { K: 'v' } },
    ])
    const args = exec.mock.calls[0]?.[1] ?? []
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('auto')
    expect(args).not.toContain('max')
  })

  it.each([
    ['reads outside the checkout', { readsOutsideCheckout: false }],
    ['no-tools steps', { can: NO_TOOLS }],
    ['shell prefixes', { can: { ...READ_ONLY, shell: ['git log'] } }],
    ['web hosts', { can: { ...READ_ONLY, web: ['a.test'] } }],
  ])('refuses %s before running anything', async (what, overrides) => {
    const exec = okExec()
    const attempt = harness.run(request(overrides), exec)
    await expect(attempt).rejects.toThrow(`agy cannot confine: ${what}`)
    expect(exec).not.toHaveBeenCalled()
  })

  it('reads the answer from fenced reply text, and usage from the object', async () => {
    const result = await harness.run(request(), okExec())
    expect(result.structured).toStrictEqual({ answer: 4 })
    expect(result.reportedUsage).toStrictEqual(result.usage)
    expect(result.usage).toStrictEqual({
      costUsd: 0.5,
      turns: 3,
      durationMs: null,
      inputTokens: 10,
      outputTokens: 2,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      byModel: {},
    })
  })

  it('prefers a structured object, and reads a bare JSON reply', async () => {
    expect((await run('{"structuredOutput":{"a":1},"result":"{\\"b\\":2}"}')).structured).toEqual({
      a: 1,
    })
    expect((await run('{"result":"{\\"b\\":2}"}')).structured).toEqual({ b: 2 })
  })

  it.each(['{}', '{"result":"prose"}', '{"result":"[1]"}', '{"result":5}', '{"result":[1]}'])(
    'leaves the answer undefined for %j and reads usage as null',
    async (stdout) => {
      const result = await run(stdout)
      expect(result.structured).toBeUndefined()
      expect(result.usage.costUsd).toBeNull()
      expect(result.usage.inputTokens).toBeNull()
    },
  )

  it.each(['', 'not json', '[1]', 'null'])('rejects malformed stdout %j', async (stdout) => {
    await expect(run(stdout)).rejects.toThrow(ReviewError)
  })

  it.each([
    ['{"error":"boom"}', 'boom'],
    ['{"error":{"message":"deep"}}', 'deep'],
    [fixture('agy-synthetic-error.json'), 'synthetic failure'],
  ])('rejects an error printed with a zero exit: %j', async (stdout, message) => {
    await expect(run(stdout)).rejects.toThrow(`Step failed: ${message}`)
  })

  it.each(['{"error":{}}', '{"type":"error"}'])('does not read %j as an error', async (stdout) => {
    expect((await run(stdout)).structured).toBeUndefined()
  })
})

describe('agy describeFailure and classifyFailure', () => {
  it('keeps the error a failed run printed', () => {
    const error = new ExecError('agy exited 1\nx', 1, fixture('agy-synthetic-error.json'), null)
    expect(harness.describeFailure(error)).toStrictEqual({
      message: 'agy exited 1: synthetic failure',
      usage: null,
    })
  })

  it.each(['', '[]'])('keeps the exec message for stdout %j', (stdout) => {
    const error = new ExecError('agy exited 1', 1, stdout, null)
    expect(harness.describeFailure(error).message).toBe('agy exited 1')
  })

  it('reports other errors by message', () => {
    expect(harness.describeFailure(new Error('x'))).toStrictEqual({ message: 'x', usage: null })
    expect(harness.describeFailure('y')).toStrictEqual({ message: 'y', usage: null })
  })

  it('classifies the sign-in message as auth and nothing else', () => {
    const out = new Error('agy exited 1\nYou are not logged into Antigravity.')
    expect(harness.classifyFailure(out)).toStrictEqual({ kind: 'auth' })
    expect(harness.classifyFailure(new Error('429'))).toStrictEqual({ kind: 'other' })
    expect(harness.classifyFailure('x')).toStrictEqual({ kind: 'other' })
  })
})
