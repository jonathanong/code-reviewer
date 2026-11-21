import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../review/benchmark/exec.mts'
import { ReviewError } from '../review/finding.mts'
import { harness } from './claude.mts'
import { NO_TOOLS, READ_ONLY, type HarnessRun } from './types.mts'

const SCHEMA = { type: 'object' }
const request = (overrides: Partial<HarnessRun> = {}): HarnessRun => ({
  prompt: 'P',
  label: 'Step',
  model: 'opus',
  maxTurns: 4,
  schema: SCHEMA,
  can: READ_ONLY,
  ...overrides,
})

const result = (extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'result', total_cost_usd: 1.5, structured_output: { ok: true }, ...extra })

describe('claude harness run', () => {
  it('runs claude -p with exactly these arguments and options for a transcript step', async () => {
    const exec = vi.fn(async (_command: string, _args: string[], _options?: object) => result())
    await harness.run(
      request({
        can: { files: true, skills: true, explorer: false, shell: ['git log'], web: ['a.test'] },
        cwd: '/tree',
        timeoutMs: 5000,
        env: { TOKEN: 't' },
        effort: 'low',
        addDirs: ['/out'],
        settings: { enabledPlugins: { 'a@m': true } },
        transcript: true,
      }),
      exec,
    )
    expect(exec.mock.calls[0]).toStrictEqual([
      'claude',
      [
        '-p',
        'P',
        '--model',
        'opus',
        '--output-format',
        'stream-json',
        '--verbose',
        '--json-schema',
        '{"type":"object"}',
        '--tools',
        'Read,Grep,Glob,Skill,Bash,WebFetch',
        '--allowedTools',
        'Read,Grep,Glob,Skill,Bash(git log:*),WebFetch(domain:a.test)',
        '--permission-mode',
        'dontAsk',
        '--max-turns',
        '4',
        '--strict-mcp-config',
        '--setting-sources',
        '',
        '--settings',
        '{"enabledPlugins":{"a@m":true}}',
        '--effort',
        'low',
        '--add-dir',
        '/out',
      ],
      { cwd: '/tree', timeoutMs: 5000, env: { TOKEN: 't' } },
    ])
  })

  it('runs a json step with no tools and passes no options object when it has none', async () => {
    const exec = vi.fn(async (_command: string, _args: string[], _options?: object) => result())
    await harness.run(request({ can: NO_TOOLS }), exec)
    expect(exec.mock.calls[0]).toStrictEqual([
      'claude',
      [
        '-p',
        'P',
        '--model',
        'opus',
        '--output-format',
        'json',
        '--json-schema',
        '{"type":"object"}',
        '--tools',
        '',
        '--permission-mode',
        'dontAsk',
        '--max-turns',
        '4',
        '--strict-mcp-config',
        '--setting-sources',
        'user',
      ],
    ])
  })

  it('passes only the options it was given', async () => {
    const exec = vi.fn(async (_command: string, _args: string[], _options?: object) => result())
    await harness.run(request({ cwd: '/snap' }), exec)
    expect(exec.mock.calls[0]?.[2]).toStrictEqual({ cwd: '/snap' })
  })

  it('reads a json step: the structured output, no skills, and the result usage', async () => {
    const run = await harness.run(request(), async () => result({ num_turns: 3 }))
    expect(run.structured).toEqual({ ok: true })
    expect(run.skills).toEqual([])
    expect(run.usage).toMatchObject({ costUsd: 1.5, turns: 3 })
    expect(run.reportedUsage).toEqual(run.usage)
    const none = await harness.run(request(), async () => 'null')
    expect(none.structured).toBeUndefined()
  })

  it('reads a transcript step: the answer, loaded skills, and what the last result event reported', async () => {
    const stdout = [
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 'u1', name: 'Skill', input: { skill: 'a:b' } }],
        },
      }),
      JSON.stringify({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'u1' }] },
      }),
      result(),
    ].join('\n')
    const run = await harness.run(request({ transcript: true }), async () => stdout)
    expect(run.structured).toEqual({ ok: true })
    expect(run.skills).toEqual(['a:b'])
    expect(run.usage.costUsd).toBe(1.5)
    expect(run.reportedUsage?.costUsd).toBe(1.5)
  })

  it('reports no usage for a transcript with an answer but no result event', async () => {
    const stdout = JSON.stringify({ structured_output: { ok: true }, total_cost_usd: 2 })
    const run = await harness.run(request({ transcript: true }), async () => stdout)
    expect(run.usage.costUsd).toBe(2)
    expect(run.reportedUsage).toBeNull()
  })

  it('names the step when a transcript holds no JSON, and lets a json step fail on a parse', async () => {
    await expect(
      harness.run(request({ transcript: true, label: 'Pillar run' }), async () => 'nope'),
    ).rejects.toThrow(new ReviewError('Pillar run did not print JSON.'))
    await expect(harness.run(request(), async () => 'nope')).rejects.toBeInstanceOf(SyntaxError)
  })

  it('lets a failed exec reject unchanged, so its output can be described', async () => {
    const failure = new ExecError(
      'claude exited with 1\ntail',
      1,
      result({ subtype: 'error_max_turns' }),
      null,
    )
    const rejected = await harness
      .run(request({ transcript: true }), async () => {
        throw failure
      })
      .catch((error: unknown) => error)
    expect(rejected).toBe(failure)
    expect(harness.describeFailure(rejected)).toMatchObject({
      message: 'claude exited with 1 (error_max_turns)\ntail',
      usage: { costUsd: 1.5 },
    })
  })
})

describe('claude harness', () => {
  it('is named for the CLI it runs', () => {
    expect(harness.name).toBe('claude')
  })
})
