import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { ReviewError } from '../review/finding.mts'
import { harness } from './opencode.mts'
import { NO_TOOLS, READ_ONLY, type HarnessRun } from './types.mts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const schema = { type: 'object', required: ['content'] }
const request = (overrides: Partial<HarnessRun> = {}): HarnessRun => ({
  prompt: 'P',
  label: 'Step',
  model: 'prov/model',
  maxTurns: 4,
  schema,
  can: READ_ONLY,
  ...overrides,
})
const execOf = (stdout: string) => vi.fn(async (_c: string, _a: string[], _o?: object) => stdout)
const okExec = () => execOf(fixture('opencode-ok.jsonl'))
const prompt = `P\n\nReply with only one JSON object matching this JSON schema. No prose and no code fence.\n${JSON.stringify(schema)}`
const args = (...rest: string[]) => [
  'run',
  prompt,
  '-m',
  'prov/model',
  '--format',
  'json',
  '--pure',
  '--print-logs',
  '--log-level',
  'ERROR',
  ...rest,
]
const READ_CONFIG = JSON.stringify({
  permission: { '*': 'deny', read: 'allow', grep: 'allow', glob: 'allow', list: 'allow' },
})
const envOf = (exec: ReturnType<typeof okExec>, call: number): string => {
  const options = exec.mock.calls[call]?.[2] as { env: Record<string, string> }
  return options.env['OPENCODE_CONFIG_CONTENT'] ?? ''
}
const lines = (...events: object[]) => events.map((event) => JSON.stringify(event)).join('\n')
const start = { type: 'step_start' }
const text = (value: string) => ({ type: 'text', part: { type: 'text', text: value } })

describe('opencode harness run', () => {
  it('runs a read-only step with these arguments and the read-only permission config', async () => {
    const exec = okExec()
    await harness.run(request(), exec)
    expect(exec.mock.calls[0]).toStrictEqual([
      'opencode',
      args(),
      { env: { OPENCODE_CONFIG_CONTENT: READ_CONFIG } },
    ])
  })

  it('denies every tool for a no-tools step', async () => {
    const exec = okExec()
    await harness.run(request({ can: NO_TOOLS }), exec)
    expect(exec.mock.calls[0]?.[2]).toStrictEqual({
      env: { OPENCODE_CONFIG_CONTENT: '{"permission":{"*":"deny"}}' },
    })
  })

  it('allows reads in exactly the listed directories outside the working directory', async () => {
    const exec = okExec()
    await harness.run(request({ cwd: '/tree', addDirs: ['/run/', '/refs'] }), exec)
    const config = JSON.parse(envOf(exec, 0))
    expect(config.permission.external_directory).toStrictEqual({
      '*': 'deny',
      '/run': 'allow',
      '/run/**': 'allow',
      '/refs': 'allow',
      '/refs/**': 'allow',
    })
    expect(config.permission['*']).toBe('deny')
    expect(config.permission.edit).toBeUndefined()
  })

  it('grants no directory to a no-tools step or an empty list', async () => {
    const exec = okExec()
    await harness.run(request({ can: NO_TOOLS, addDirs: ['/run'] }), exec)
    await harness.run(request({ addDirs: [] }), exec)
    expect(envOf(exec, 0)).toBe('{"permission":{"*":"deny"}}')
    expect(envOf(exec, 1)).toBe(READ_CONFIG)
  })

  it('passes effort, cwd and timeout, and its config wins over the request env', async () => {
    const exec = okExec()
    await harness.run(
      request({
        effort: 'low',
        cwd: '/tree',
        timeoutMs: 5000,
        env: { TOKEN: 't', OPENCODE_CONFIG_CONTENT: '{}' },
      }),
      exec,
    )
    expect(exec.mock.calls[0]).toStrictEqual([
      'opencode',
      args('--variant', 'low'),
      { cwd: '/tree', timeoutMs: 5000, env: { TOKEN: 't', OPENCODE_CONFIG_CONTENT: READ_CONFIG } },
    ])
  })

  it('never passes --auto', async () => {
    const exec = okExec()
    await harness.run(request(), exec)
    expect(exec.mock.calls[0]?.[1]).not.toContain('--auto')
  })

  it.each([
    ['shell', { shell: ['git log'] }, 'shell prefixes'],
    ['web', { web: ['a.test'] }, 'web hosts'],
  ])('refuses %s before running anything', async (_name, can, what) => {
    const exec = okExec()
    const run = harness.run(request({ can: { ...READ_ONLY, ...can } }), exec)
    await expect(run).rejects.toThrow(ReviewError)
    await expect(run).rejects.toThrow(`opencode cannot confine: ${what} (Step)`)
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('opencode output', () => {
  it('reads the recorded answer and sums usage over every step', async () => {
    const result = await harness.run(request(), okExec())
    expect(result.structured).toStrictEqual({ content: 'hello' })
    expect(result.skills).toStrictEqual([])
    expect(result.reportedUsage).toStrictEqual(result.usage)
    const used = {
      inputTokens: 3360,
      outputTokens: 71,
      cacheReadTokens: 3072,
      cacheCreationTokens: 0,
      costUsd: 0,
    }
    expect(result.usage).toStrictEqual({
      ...used,
      turns: 2,
      durationMs: null,
      byModel: { 'prov/model': used },
    })
  })

  it('sums cost and cache writes and treats missing token fields as zero', async () => {
    const finish = (part: object) => ({ type: 'step_finish', part })
    const stdout = lines(
      start,
      text('{"content":1}'),
      finish({ cost: 0.5, tokens: { input: 1, output: 2, cache: { write: 3, read: 4 } } }),
      finish({ cost: 0.25, tokens: { input: 'x', cache: 7 } }),
      { type: 'step_finish', part: 5 },
      { type: 'step_finish' },
    )
    const { usage } = await harness.run(request(), execOf(stdout))
    expect(usage).toMatchObject({
      costUsd: 0.75,
      turns: 4,
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationTokens: 3,
      cacheReadTokens: 4,
    })
  })

  it('reads only the text after the last step_start', async () => {
    const stdout = lines(start, text('thinking aloud'), start, text('{"content":'), text('2}'))
    const result = await harness.run(request(), execOf(stdout))
    expect(result.structured).toStrictEqual({ content: 2 })
  })

  it.each(['```json\n{"content":3}\n```', '```\n{"content":3}```', '  {"content":3}\n'])(
    'tolerates a fence or whitespace around %j',
    async (reply) => {
      const result = await harness.run(request(), execOf(lines(start, text(reply))))
      expect(result.structured).toStrictEqual({ content: 3 })
    },
  )

  it('accepts any object when the schema requires nothing', async () => {
    const result = await harness.run(request({ schema: {} }), execOf(lines(start, text('{"a":1}'))))
    expect(result.structured).toStrictEqual({ a: 1 })
  })

  it.each([
    ['non-JSON text', lines(start, text('sorry'))],
    ['an array', lines(start, text('[{"content":1}]'))],
    ['null', lines(start, text('null'))],
    ['a missing required key', lines(start, text('{"other":1}'))],
    ['no text events', lines(start, { type: 'step_finish', part: {} })],
    ['a non-string text', lines(start, { type: 'text', part: { text: 4 } })],
    ['empty output', ''],
  ])('rejects %s, naming the step', async (_name, stdout) => {
    const run = harness.run(request(), execOf(stdout))
    await expect(run).rejects.toThrow(ReviewError)
    await expect(run).rejects.toThrow('Step')
  })

  it('rejects an error event printed with a zero exit', async () => {
    const run = harness.run(request(), execOf(fixture('opencode-error.jsonl')))
    await expect(run).rejects.toThrow(
      'Step failed: Unexpected server error. Check server logs for details.',
    )
  })

  it('does not take an error event without a message as a failure', async () => {
    const stdout = lines(
      { type: 'error', error: { data: 3 } },
      { type: 'error' },
      start,
      text('{"content":1}'),
    )
    const result = await harness.run(request(), execOf(stdout))
    expect(result.structured).toStrictEqual({ content: 1 })
  })
})

describe('opencode describeFailure', () => {
  it('keeps the error event a failed run printed', () => {
    const error = new ExecError(
      'opencode exited with 1\nboom',
      1,
      fixture('opencode-error.jsonl'),
      null,
    )
    expect(harness.describeFailure(error)).toStrictEqual({
      message: 'opencode exited with 1: Unexpected server error. Check server logs for details.',
      usage: null,
    })
  })

  it.each(['', '{"type":"error"}', '[]'])('keeps the exec message for stdout %j', (stdout) => {
    const error = new ExecError('opencode exited with 1', 1, stdout, null)
    expect(harness.describeFailure(error)).toStrictEqual({
      message: 'opencode exited with 1',
      usage: null,
    })
  })

  it('reports other errors by message', () => {
    expect(harness.describeFailure(new Error('x'))).toStrictEqual({ message: 'x', usage: null })
    expect(harness.describeFailure('y')).toStrictEqual({ message: 'y', usage: null })
  })
})

describe('opencode classifyFailure', () => {
  it('classifies an unrecognised failure as not one to wait out', () => {
    const error = new ExecError('opencode exited with 1', 1, fixture('opencode-error.jsonl'), null)
    expect(harness.classifyFailure(error)).toStrictEqual({ kind: 'other' })
    expect(harness.classifyFailure('Free usage limit reached')).toStrictEqual({ kind: 'other' })
  })

  it('reads the free usage limit from the log tail of a run killed at its timeout', () => {
    const log =
      'level=ERROR message="stream error" error.error="AI_APICallError: Free usage limit reached. Free models work in OpenCode"'
    const error = new ExecError(`opencode exited with null\n${log}`, null, '', null)
    expect(harness.classifyFailure(error)).toStrictEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 3600,
    })
  })
})
