import { describe, expect, it } from 'vitest'

import { EXPLORER_AGENTS, claudeArgs, isolationArgs } from './claude-args.mts'
import { READ_ONLY, type Capabilities, type HarnessRun } from './types.mts'

const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

const SCHEMA = { type: 'object', required: ['findings'] }
const PILLAR: Capabilities = { ...READ_ONLY, skills: true, explorer: true }
const run = (overrides: Partial<HarnessRun> = {}): HarnessRun => ({
  prompt: 'P',
  label: 'Run',
  model: 'sonnet',
  maxTurns: 12,
  schema: SCHEMA,
  can: PILLAR,
  ...overrides,
})

describe('claudeArgs', () => {
  const args = claudeArgs(run({ effort: 'medium', transcript: true }))

  it('restricts claude to read-only tools, the explorer, skills, and a JSON schema', () => {
    expect(args.slice(0, 4)).toEqual(['-p', 'P', '--model', 'sonnet'])
    expect(value(args, '--tools')).toBe('Read,Grep,Glob,Agent,Skill')
    expect(value(args, '--allowedTools')).toBe('Read,Grep,Glob,Agent,Skill')
    expect(
      args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 3),
    ).toEqual(['--output-format', 'stream-json', '--verbose'])
    expect(value(args, '--permission-mode')).toBe('dontAsk')
    expect(value(args, '--max-turns')).toBe('12')
    expect(JSON.parse(value(args, '--json-schema') as string)).toEqual(SCHEMA)
  })

  it('skips MCP servers, reads user settings only, and sets the effort', () => {
    expect(args).toContain('--strict-mcp-config')
    expect(value(args, '--setting-sources')).toBe('user')
    expect(value(args, '--effort')).toBe('medium')
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--settings')
    expect(args).not.toContain('--add-dir')
  })

  it('loads no settings file when the run has a shell or the web', () => {
    const shell = claudeArgs(run({ can: { ...READ_ONLY, shell: ['git log'] }, transcript: true }))
    expect(value(shell, '--setting-sources')).toBe('')
    const web = claudeArgs(run({ can: { ...PILLAR, web: ['a.example.com'] } }))
    expect(value(web, '--setting-sources')).toBe('')
    expect(value(web, '--permission-mode')).toBe('dontAsk')
  })

  it('defines the haiku explorer subagent with read-only tools, only when allowed', () => {
    expect(JSON.parse(value(args, '--agents') as string)).toEqual(EXPLORER_AGENTS)
    expect(EXPLORER_AGENTS.explorer.model).toBe('haiku')
    expect(EXPLORER_AGENTS.explorer.tools).toEqual(['Read', 'Grep', 'Glob'])
    const without = claudeArgs(run({ can: READ_ONLY }))
    expect(without).not.toContain('--agents')
    expect(value(without, '--tools')).toBe('Read,Grep,Glob')
  })

  it('takes effort, plugin settings, and extra directories from the caller', () => {
    const custom = claudeArgs(
      run({
        effort: 'low',
        settings: { enabledPlugins: { 'skills@m': true } },
        addDirs: ['/run', '/refs'],
        transcript: true,
      }),
    )
    expect(value(custom, '--effort')).toBe('low')
    expect(JSON.parse(value(custom, '--settings') as string)).toEqual({
      enabledPlugins: { 'skills@m': true },
    })
    expect(custom.slice(custom.indexOf('--add-dir'))).toEqual(['--add-dir', '/run', '/refs'])
    expect(claudeArgs(run({ addDirs: [] }))).not.toContain('--add-dir')
    expect(claudeArgs(run({ transcript: true }))).not.toContain('--effort')
  })

  it('asks for one json result instead of the stream unless the transcript is read', () => {
    const final = claudeArgs(run())
    expect(final.slice(final.indexOf('--output-format'), final.indexOf('--json-schema'))).toEqual([
      '--output-format',
      'json',
    ])
  })

  it('grants no tools, and no allow-list, to a run without capabilities', () => {
    const none = claudeArgs(run({ can: { ...READ_ONLY, files: false } }))
    expect(value(none, '--tools')).toBe('')
    expect(none).not.toContain('--allowedTools')
  })
})

describe('isolationArgs', () => {
  it('adds --settings only when settings are known', () => {
    expect(isolationArgs()).toEqual(['--strict-mcp-config', '--setting-sources', 'user'])
    expect(isolationArgs(undefined, true)).toEqual(['--strict-mcp-config', '--setting-sources', ''])
    expect(isolationArgs({ enabledPlugins: {} }).slice(3)).toEqual([
      '--settings',
      '{"enabledPlugins":{}}',
    ])
  })
})
