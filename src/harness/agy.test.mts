import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { ReviewError } from '../review/finding.mts'
import { AGY_TOOL_NOTE, agyToolNote } from './agy-args.mts'
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
  `P\n\n${AGY_TOOL_NOTE}`,
  '--model',
  'm1',
  '--output-format',
  'json',
  '--json-schema',
  '{"type":"object"}',
  '--sandbox',
  '--settings',
  '{"permissions":{"allow":["read_url(invalid)"]}}',
  '--disable-slash-commands',
]
const withWeb = (web: string[]) => ({ can: { ...READ_ONLY, web } })

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

  it.each(['low', 'medium', 'high', 'xhigh'])(
    'leaves --effort out when the model id already ends in -%s',
    async (suffix) => {
      const exec = okExec()
      await harness.run(request({ model: `gemini-4-hydrogen-${suffix}`, effort: 'low' }), exec)
      const args = exec.mock.calls[0]?.[1] ?? []
      expect(args).toContain(`gemini-4-hydrogen-${suffix}`)
      expect(args).not.toContain('--effort')
    },
  )

  it('still passes --effort for a model id with no effort suffix', async () => {
    const exec = okExec()
    await harness.run(request({ model: 'gemini-4-hydrogen', effort: 'low' }), exec)
    const args = exec.mock.calls[0]?.[1] ?? []
    expect(args.slice(args.indexOf('--effort'), args.indexOf('--effort') + 2)).toEqual([
      '--effort',
      'low',
    ])
  })

  it.each([
    ['reads outside the checkout', { readsOutsideCheckout: false }],
    ['no-tools steps', { can: NO_TOOLS }],
    ['shell prefixes', { can: { ...READ_ONLY, shell: ['git log'] } }],
  ])('refuses %s before running anything', async (what, overrides) => {
    const exec = okExec()
    const attempt = harness.run(request(overrides), exec)
    await expect(attempt).rejects.toThrow(`agy cannot confine: ${what}`)
    expect(exec).not.toHaveBeenCalled()
  })

  it('allows only the granted hosts: one read_url rule each, and a note naming them', async () => {
    const exec = okExec()
    await harness.run(request(withWeb(['docs.a.test', 'b.test'])), exec)
    const args = exec.mock.calls[0]?.[1] ?? []
    const settings = args[args.indexOf('--settings') + 1] ?? ''
    expect(JSON.parse(settings)).toStrictEqual({
      permissions: { allow: ['read_url(docs.a.test)', 'read_url(b.test)'] },
    })
    expect(args[1]).toBe(`P\n\n${agyToolNote(['docs.a.test', 'b.test'])}`)
    expect(args[1]).toContain('curl -sL <https URL>')
    expect(args[1]).not.toContain('do not run shell commands')
    expect(args[1]).toContain('docs.a.test, b.test')
    expect(args.at(-1)).toBe('--disable-slash-commands')
  })

  it('allows one host with a single rule and keeps the note plain without hosts', async () => {
    const exec = okExec()
    await harness.run(request(withWeb(['a.test'])), exec)
    const args = exec.mock.calls[0]?.[1] ?? []
    expect(args).toContain('{"permissions":{"allow":["read_url(a.test)"]}}')
    expect(agyToolNote([])).toBe(AGY_TOOL_NOTE)
    expect(AGY_TOOL_NOTE).not.toContain('curl')
  })

  it.each([
    '*.a.test',
    'https://a.test',
    'a.test:443',
    'a.test/x',
    'a b.test',
    'a.test)',
    '(a.test',
    '',
  ])('refuses the web host %j before running anything', async (host) => {
    const exec = okExec()
    await expect(harness.run(request(withWeb([host])), exec)).rejects.toThrow(
      'agy cannot confine: web host',
    )
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

  it('reports a denied action when there is no answer, with the real agy output shape', async () => {
    const stdout = JSON.stringify({
      status: 'SUCCESS',
      response: '',
      denied_actions: [{ action: 'command', display_name: 'Bash' }, {}, 'x'],
    })
    await expect(run(stdout)).rejects.toThrow(
      'Step failed: agy denied Bash, an action, an action: headless mode cannot approve it.',
    )
    expect(
      (await run('{"structured_output":{"a":1},"denied_actions":[{"action":"c"}]}')).structured,
    ).toEqual({ a: 1 })
    expect((await run('{"denied_actions":[]}')).structured).toBeUndefined()
    expect((await run('{"denied_actions":"x"}')).structured).toBeUndefined()
  })

  it('keeps the usage of a denied run on the error and in describeFailure', async () => {
    const usage = {
      input_tokens: 20664,
      output_tokens: 227,
      thinking_tokens: 79,
      cache_read_tokens: 16348,
    }
    const stdout = JSON.stringify({
      usage,
      denied_actions: [{ action: 'write_file', display_name: 'Edit' }],
    })
    const error = await run(stdout).catch((caught: unknown) => caught)
    const described = harness.describeFailure(error)
    expect(described.message).toBe('Step failed: agy denied Edit: headless mode cannot approve it.')
    expect(described.usage).toMatchObject({
      inputTokens: 20664,
      outputTokens: 306,
      cacheReadTokens: 16348,
    })
  })

  it('reads agy usage keys, adding thinking tokens to output', async () => {
    const usage = { input_tokens: 5, output_tokens: 2, thinking_tokens: 3, cache_read_tokens: 7 }
    const result = await run(JSON.stringify({ structured_output: {}, usage }))
    expect(result.usage).toMatchObject({ inputTokens: 5, outputTokens: 5, cacheReadTokens: 7 })
    const thinkingOnly = await run(JSON.stringify({ usage: { thinking_tokens: 3 } }))
    expect(thinkingOnly.usage.outputTokens).toBe(3)
  })

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
