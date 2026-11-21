import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { ReviewError } from '../review/finding.mts'
import { harness } from './codex.mts'
import { NO_TOOLS, READ_ONLY, type HarnessRun } from './types.mts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const request = (overrides: Partial<HarnessRun> = {}): HarnessRun => ({
  prompt: 'P',
  label: 'Step',
  model: 'gpt-x',
  maxTurns: 4,
  schema: { type: 'object' },
  can: READ_ONLY,
  readsOutsideCheckout: true,
  ...overrides,
})
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1] ?? ''

/** A fake `codex exec` that writes `answer` to the `-o` file and prints `stdout`. */
const fakeExec = (answer: string | undefined, stdout = fixture('codex-ok.jsonl')) =>
  vi.fn(async (_command: string, args: string[], _options?: object) => {
    if (answer !== undefined) writeFileSync(after(args, '-o'), answer)
    return stdout
  })

describe('codex harness run', () => {
  it('runs a read-only step with exactly these arguments', async () => {
    const exec = fakeExec('{"answer":4}')
    await harness.run(request(), exec)
    const [command, args = [], options] = exec.mock.calls[0] ?? []
    expect(command).toBe('codex')
    expect(options).toStrictEqual({})
    const schema = after(args, '--output-schema')
    const last = after(args, '-o')
    expect(args).toStrictEqual([
      'exec',
      '-m',
      'gpt-x',
      '-s',
      'read-only',
      '--json',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--skip-git-repo-check',
      '--output-schema',
      schema,
      '-o',
      last,
      '-c',
      'web_search="disabled"',
      '-c',
      'project_doc_max_bytes=0',
      '--',
      'P',
    ])
  })

  it('writes the schema for the run and removes its files afterward', async () => {
    let schemaFile = ''
    let schemaText = ''
    const exec = vi.fn(async (_c: string, args: string[]) => {
      schemaFile = after(args, '--output-schema')
      schemaText = readFileSync(schemaFile, 'utf8')
      writeFileSync(after(args, '-o'), '{"answer":4}')
      return fixture('codex-ok.jsonl')
    })
    await harness.run(request({ schema: { type: 'object', required: ['answer'] } }), exec)
    expect(JSON.parse(schemaText)).toStrictEqual({ type: 'object', required: ['answer'] })
    expect(existsSync(schemaFile)).toBe(false)
  })

  it('removes its files when the run fails', async () => {
    let schemaFile = ''
    const exec = vi.fn(async (_c: string, args: string[]) => {
      schemaFile = after(args, '--output-schema')
      throw new Error('boom')
    })
    await expect(harness.run(request(), exec)).rejects.toThrow('boom')
    expect(existsSync(schemaFile)).toBe(false)
  })

  it('passes effort, cwd, timeout and env, and never add-dirs', async () => {
    const exec = fakeExec('{"answer":4}')
    await harness.run(
      request({
        effort: 'low',
        addDirs: ['/a'],
        cwd: '/tree',
        timeoutMs: 5000,
        env: { TOKEN: 't' },
        maxTurns: 9,
        can: { ...READ_ONLY, skills: true, explorer: true },
        settings: {},
        transcript: true,
      }),
      exec,
    )
    const [, args = [], options] = exec.mock.calls[0] ?? []
    expect(args.slice(-4)).toStrictEqual(['-c', 'model_reasoning_effort="low"', '--', 'P'])
    expect(args).not.toContain('--add-dir')
    expect(options).toStrictEqual({ cwd: '/tree', timeoutMs: 5000, env: { TOKEN: 't' } })
  })

  it('never passes an approval or sandbox bypass', async () => {
    const exec = fakeExec('{"answer":4}')
    await harness.run(request(), exec)
    const args = exec.mock.calls[0]?.[1] ?? []
    expect(args.filter((arg) => /bypass|approve|danger|workspace-write/u.test(arg))).toStrictEqual(
      [],
    )
  })

  it.each([
    ['reads-outside', { readsOutsideCheckout: false }, 'reads outside the checkout'],
    ['no-tools', { can: NO_TOOLS }, 'no-tools steps'],
    ['shell', { can: { ...READ_ONLY, shell: ['git log'] } }, 'shell prefixes'],
    ['web', { can: { ...READ_ONLY, web: ['a.test'] } }, 'web hosts'],
  ])('refuses %s before running anything', async (_name, overrides, what) => {
    const exec = fakeExec('{}')
    const run = harness.run(request(overrides), exec)
    await expect(run).rejects.toThrow(`codex cannot confine: ${what}`)
    expect(exec).not.toHaveBeenCalled()
  })

  it('parses the final message and sums usage over turns', async () => {
    const result = await harness.run(request(), fakeExec('{"answer":4}'))
    expect(result.structured).toStrictEqual({ answer: 4 })
    expect(result.skills).toStrictEqual([])
    expect(result.reportedUsage).toStrictEqual(result.usage)
    const used = {
      inputTokens: 1200,
      outputTokens: 30,
      cacheReadTokens: 800,
      cacheCreationTokens: 50,
      costUsd: null,
    }
    expect(result.usage).toStrictEqual({
      ...used,
      turns: 1,
      durationMs: null,
      byModel: { 'gpt-x': used },
    })
  })

  it('reads missing usage fields as zero over zero turns', async () => {
    const result = await harness.run(
      request(),
      fakeExec('{"a":1}', 'not json\n{"type":"turn.completed","usage":3}\n[1]'),
    )
    expect(result.usage.turns).toBe(1)
    expect(result.usage.inputTokens).toBe(0)
  })

  it.each([undefined, '', 'not json'])('rejects an unparseable final message %j', async (text) => {
    await expect(harness.run(request(), fakeExec(text))).rejects.toThrow(ReviewError)
  })

  it('treats an error event followed by a completed turn as a success', async () => {
    const stdout = `${fixture('codex-error.jsonl')}${fixture('codex-ok.jsonl')}`
    const result = await harness.run(request(), fakeExec('{"answer":4}', stdout))
    expect(result.structured).toStrictEqual({ answer: 4 })
  })

  it('writes a strict schema and drops the nulls it forced on optional properties', async () => {
    let written: unknown
    const exec = vi.fn(async (_c: string, args: string[]) => {
      written = JSON.parse(readFileSync(after(args, '--output-schema'), 'utf8'))
      writeFileSync(after(args, '-o'), '{"a":1,"b":null}')
      return fixture('codex-ok.jsonl')
    })
    const schema = { type: 'object', required: ['a'], properties: { a: {}, b: { type: 'string' } } }
    const result = await harness.run(request({ schema }), exec)
    expect(written).toMatchObject({ required: ['a', 'b'], additionalProperties: false })
    expect(result.structured).toStrictEqual({ a: 1 })
  })

  it('keeps the usage of a completed turn when the answer is rejected', async () => {
    const run = harness.run(request(), fakeExec('not json'))
    await expect(run).rejects.toBeInstanceOf(ReviewError)
    const error = await run.catch((caught: unknown) => caught)
    expect(harness.describeFailure(error).usage).toMatchObject({ turns: 1, inputTokens: 1200 })
  })

  it('has no usage to keep when no turn completed', async () => {
    const run = harness.run(request(), fakeExec(undefined, fixture('codex-error.jsonl')))
    const error = await run.catch((caught: unknown) => caught)
    expect(harness.describeFailure(error)).toMatchObject({ usage: null })
  })

  it('rejects an error event printed with a zero exit', async () => {
    await expect(
      harness.run(request(), fakeExec('{"a":1}', fixture('codex-error.jsonl'))),
    ).rejects.toThrow(ReviewError)
  })
})

describe('codex describeFailure', () => {
  it('keeps the error event a failed run printed', () => {
    const error = new ExecError('codex exited with 1\nboom', 1, fixture('codex-error.jsonl'), null)
    expect(harness.describeFailure(error)).toStrictEqual({
      message: 'codex exited with 1: You have hit your usage limit.',
      usage: null,
    })
  })

  it('reads a turn.failed event when no error event came first', () => {
    const stdout = '{"type":"turn.failed","error":{"message":"bad"}}'
    const error = new ExecError('codex exited with 1', 1, stdout, null)
    expect(harness.describeFailure(error).message).toBe('codex exited with 1: bad')
  })

  it.each([
    '',
    '{"type":"error"}',
    '{"type":"turn.failed","error":5}',
    '{"type":"turn.failed","error":{}}',
  ])('keeps the exec message for stdout %j', (stdout) => {
    const error = new ExecError('codex exited with 1', 1, stdout, null)
    expect(harness.describeFailure(error)).toStrictEqual({
      message: 'codex exited with 1',
      usage: null,
    })
  })

  it('reports other errors by message', () => {
    expect(harness.describeFailure(new Error('x'))).toStrictEqual({ message: 'x', usage: null })
    expect(harness.describeFailure('y')).toStrictEqual({ message: 'y', usage: null })
  })
})

describe('codex classifyFailure', () => {
  it('waits out nothing for a usage limit but moves on, with a long retry-after', () => {
    const limited = new ExecError('codex exited with 1\nYou have hit your usage limit', 1, '', null)
    expect(harness.classifyFailure(limited)).toStrictEqual({
      kind: 'rate_limited',
      retryAfterSeconds: 3600,
    })
  })

  it('classifies a login problem as auth', () => {
    expect(harness.classifyFailure(new Error('Not logged in'))).toStrictEqual({ kind: 'auth' })
  })

  it.each([new Error('boom'), 'text'])('leaves %j as other', (error) => {
    expect(harness.classifyFailure(error)).toStrictEqual({ kind: 'other' })
  })
})
