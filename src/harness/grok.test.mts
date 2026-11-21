import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { ReviewError } from '../review/finding.mts'
import { harness } from './grok.mts'
import { GROK_ENV } from './grok-args.mts'
import { NO_TOOLS, READ_ONLY, type HarnessRun } from './types.mts'

const fixture = (name: string) =>
  readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const request = (overrides: Partial<HarnessRun> = {}): HarnessRun => ({
  prompt: 'P',
  label: 'Step',
  model: 'grok-4.6-build',
  maxTurns: 4,
  schema: { type: 'object' },
  can: READ_ONLY,
  ...overrides,
})
const okExec = () => vi.fn(async (_c: string, _a: string[], _o?: object) => fixture('grok-ok.json'))

const tail = (turns: string) => [
  '--disallowed-tools',
  'search_tool,use_tool',
  '--permission-mode',
  'dontAsk',
  '--max-turns',
  turns,
  '--no-subagents',
  '--disable-web-search',
]
const head = (tools: string) => [
  '-p',
  'P',
  '-m',
  'grok-4.6-build',
  '--output-format',
  'json',
  '--json-schema',
  '{"type":"object"}',
  '--tools',
  tools,
]
const ENV = {
  GROK_CLAUDE_SKILLS_ENABLED: '0',
  GROK_CLAUDE_RULES_ENABLED: '0',
  GROK_CLAUDE_MCPS_ENABLED: '0',
  GROK_CLAUDE_HOOKS_ENABLED: '0',
  GROK_CLAUDE_AGENTS_ENABLED: '0',
  GROK_CURSOR_SKILLS_ENABLED: '0',
  GROK_CURSOR_RULES_ENABLED: '0',
  GROK_CURSOR_MCPS_ENABLED: '0',
  GROK_CURSOR_HOOKS_ENABLED: '0',
  GROK_CURSOR_AGENTS_ENABLED: '0',
}

describe('grok harness run', () => {
  it('runs a read-only step with exactly these arguments', async () => {
    const exec = okExec()
    await harness.run(request(), exec)
    expect(exec.mock.calls[0]).toStrictEqual([
      'grok',
      [...head('read_file,list_dir,grep'), ...tail('4')],
      { env: ENV },
    ])
  })

  it('runs a no-tools step with an empty --tools', async () => {
    const exec = okExec()
    await harness.run(request({ can: NO_TOOLS }), exec)
    expect(exec.mock.calls[0]?.[1]).toStrictEqual([...head(''), ...tail('4')])
  })

  it('passes effort, add-dirs, cwd, timeout, and merges env with the switches winning', async () => {
    const exec = okExec()
    await harness.run(
      request({
        effort: 'low',
        addDirs: ['/a', '/b'],
        cwd: '/tree',
        timeoutMs: 5000,
        env: { TOKEN: 't', GROK_CLAUDE_SKILLS_ENABLED: '1' },
        maxTurns: 7,
        can: { ...READ_ONLY, skills: true, explorer: true },
        settings: { enabledPlugins: {} },
        transcript: true,
      }),
      exec,
    )
    expect(exec.mock.calls[0]).toStrictEqual([
      'grok',
      [
        ...head('read_file,list_dir,grep'),
        ...tail('7'),
        '--reasoning-effort',
        'low',
        '--add-dir',
        '/a',
        '--add-dir',
        '/b',
      ],
      { cwd: '/tree', timeoutMs: 5000, env: { TOKEN: 't', ...ENV } },
    ])
  })

  it('sets all ten switches', () => {
    expect(GROK_ENV).toStrictEqual(ENV)
  })

  it.each([
    ['shell', { shell: ['git log'] }, 'shell prefixes'],
    ['web', { web: ['a.test'] }, 'web hosts'],
  ])('refuses %s before running anything', async (_name, can, what) => {
    const exec = okExec()
    const run = harness.run(request({ can: { ...READ_ONLY, ...can } }), exec)
    await expect(run).rejects.toThrow(ReviewError)
    await expect(run).rejects.toThrow(`grok cannot confine: ${what}`)
    expect(exec).not.toHaveBeenCalled()
  })

  it('parses the recorded result into structured output and usage', async () => {
    const result = await harness.run(request(), okExec())
    expect(result.structured).toStrictEqual({ answer: 4 })
    expect(result.skills).toStrictEqual([])
    expect(result.reportedUsage).toStrictEqual(result.usage)
    expect(result.usage).toStrictEqual({
      costUsd: 0.050106,
      turns: 1,
      durationMs: null,
      inputTokens: 24750,
      outputTokens: 101,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      byModel: {
        'grok-4.6-build': {
          inputTokens: 24750,
          outputTokens: 101,
          cacheReadTokens: 0,
          cacheCreationTokens: 0,
          costUsd: 0.050106,
        },
      },
    })
  })

  it('reads missing and malformed usage fields as null', async () => {
    const exec = vi.fn(async () => '{"usage":5,"modelUsage":{"m":3,"n":{}},"total_cost_usd":"x"}')
    const result = await harness.run(request(), exec)
    expect(result.structured).toBeUndefined()
    expect(result.usage.costUsd).toBeNull()
    expect(result.usage.inputTokens).toBeNull()
    expect(result.usage.byModel).toStrictEqual({
      n: {
        inputTokens: null,
        outputTokens: null,
        cacheReadTokens: null,
        cacheCreationTokens: null,
        costUsd: null,
      },
    })
    const arrayModels = await harness.run(
      request(),
      vi.fn(async () => '{"modelUsage":[]}'),
    )
    expect(arrayModels.usage.byModel).toStrictEqual({})
  })

  it.each(['', 'not json', '[1]', 'null'])('rejects malformed stdout %j', async (stdout) => {
    await expect(
      harness.run(
        request(),
        vi.fn(async () => stdout),
      ),
    ).rejects.toThrow(ReviewError)
  })

  it('rejects an error object printed with a zero exit', async () => {
    await expect(
      harness.run(
        request(),
        vi.fn(async () => fixture('grok-error.json')),
      ),
    ).rejects.toThrow('Step failed: 429 rate limit exceeded')
  })
})

describe('grok describeFailure', () => {
  it('keeps the error object a failed run printed', () => {
    const error = new ExecError('grok exited with 1\nboom', 1, fixture('grok-error.json'), null)
    expect(harness.describeFailure(error)).toStrictEqual({
      message: 'grok exited with 1: 429 rate limit exceeded',
      usage: null,
    })
  })

  it.each(['', '{"type":"error"}', '[]'])('keeps the exec message for stdout %j', (stdout) => {
    const error = new ExecError('grok exited with 1', 1, stdout, null)
    expect(harness.describeFailure(error)).toStrictEqual({
      message: 'grok exited with 1',
      usage: null,
    })
  })

  it('reports other errors by message', () => {
    expect(harness.describeFailure(new Error('x'))).toStrictEqual({ message: 'x', usage: null })
    expect(harness.describeFailure('y')).toStrictEqual({ message: 'y', usage: null })
  })
})

describe('grok classifyFailure', () => {
  it('never classifies a failure as one to wait out', () => {
    const limited = new ExecError('grok exited with 1', 1, '{"type":"error","message":"429"}', null)
    expect(harness.classifyFailure(limited)).toStrictEqual({ kind: 'other' })
  })
})
