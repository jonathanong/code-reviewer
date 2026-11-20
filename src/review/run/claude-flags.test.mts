import { describe, expect, it } from 'vitest'

import {
  CLAUDE_EFFORT,
  EXPLORER_AGENTS,
  PILLAR_OUTPUT_SCHEMA,
  PILLAR_TOOLS,
  PILLAR_TOOLS_NO_SKILLS,
  READ_ONLY_TOOLS,
  SKILL_TOOLS,
  isolationArgs,
  pillarArgs,
  pillarToolFlags,
} from './claude-flags.mts'

const value = (args: string[], flag: string) => args[args.indexOf(flag) + 1]

describe('pillarArgs', () => {
  const args = pillarArgs({ prompt: 'P', model: 'sonnet', maxTurns: 12 })

  it('restricts claude to read-only tools, the explorer, skills, and a JSON schema', () => {
    expect(args.slice(0, 4)).toEqual(['-p', 'P', '--model', 'sonnet'])
    expect(PILLAR_TOOLS).toBe('Read,Grep,Glob,Agent,Skill')
    expect(value(args, '--tools')).toBe(PILLAR_TOOLS)
    expect(value(args, '--allowedTools')).toBe(PILLAR_TOOLS)
    expect(
      args.slice(args.indexOf('--output-format'), args.indexOf('--output-format') + 3),
    ).toEqual(['--output-format', 'stream-json', '--verbose'])
    expect(value(args, '--permission-mode')).toBe('dontAsk')
    expect(value(args, '--max-turns')).toBe('12')
    expect(JSON.parse(value(args, '--json-schema') as string)).toEqual(PILLAR_OUTPUT_SCHEMA)
  })

  it('skips MCP servers, reads user settings only, and sets the effort', () => {
    expect(args).toContain('--strict-mcp-config')
    expect(value(args, '--setting-sources')).toBe('user')
    expect(value(args, '--effort')).toBe(CLAUDE_EFFORT.full)
    expect(args).not.toContain('--mcp-config')
    expect(args).not.toContain('--settings')
    expect(args).not.toContain('--add-dir')
  })

  it('loads no settings file when the run has a shell', () => {
    const shell = pillarArgs({ prompt: 'P', model: 'haiku', maxTurns: 3, tools: 'Read,Bash' })
    expect(value(shell, '--setting-sources')).toBe('')
  })

  it('defines the haiku explorer subagent with read-only tools', () => {
    expect(JSON.parse(value(args, '--agents') as string)).toEqual(EXPLORER_AGENTS)
    expect(EXPLORER_AGENTS.explorer.model).toBe('haiku')
    expect(EXPLORER_AGENTS.explorer.tools).toEqual(['Read', 'Grep', 'Glob'])
  })

  it('takes tools, effort, plugin settings, and extra directories from the caller', () => {
    const custom = pillarArgs({
      prompt: 'P',
      model: 'haiku',
      maxTurns: 3,
      tools: PILLAR_TOOLS_NO_SKILLS,
      effort: CLAUDE_EFFORT.light,
      settings: { enabledPlugins: { 'skills@m': true } },
      addDirs: ['/run', '/refs'],
    })
    expect(value(custom, '--allowedTools')).toBe(PILLAR_TOOLS_NO_SKILLS)
    expect(value(custom, '--effort')).toBe('low')
    expect(JSON.parse(value(custom, '--settings') as string)).toEqual({
      enabledPlugins: { 'skills@m': true },
    })
    expect(custom.slice(custom.indexOf('--add-dir'))).toEqual(['--add-dir', '/run', '/refs'])
    expect(pillarArgs({ prompt: 'P', model: 'm', maxTurns: 1, addDirs: [] })).not.toContain(
      '--add-dir',
    )
  })
})

describe('tool sets', () => {
  it('keeps the verifier read-only and the control runs without a Skill tool', () => {
    expect(READ_ONLY_TOOLS).toBe('Read,Grep,Glob')
    expect(SKILL_TOOLS).toBe('Read,Grep,Glob,Skill')
    expect(PILLAR_TOOLS_NO_SKILLS).toBe('Read,Grep,Glob,Agent')
  })

  it('maps a light plan to low effort and a full plan to medium', () => {
    expect(CLAUDE_EFFORT).toEqual({ light: 'low', full: 'medium' })
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

describe('pillarToolFlags', () => {
  it('gives a non-history pillar the pillar tools, without Skill for a control run', () => {
    expect(pillarToolFlags('design')).toEqual({ tools: PILLAR_TOOLS, allowedTools: PILLAR_TOOLS })
    expect(pillarToolFlags('design', false)).toEqual({
      tools: PILLAR_TOOLS_NO_SKILLS,
      allowedTools: PILLAR_TOOLS_NO_SKILLS,
    })
  })

  it('limits the history pillar shell to git log and git show', () => {
    expect(pillarToolFlags('history')).toEqual({
      tools: `${PILLAR_TOOLS},Bash`,
      allowedTools: `${PILLAR_TOOLS},Bash(git log:*),Bash(git show:*)`,
    })
    expect(pillarToolFlags('history', false)).toEqual({
      tools: `${PILLAR_TOOLS_NO_SKILLS},Bash`,
      allowedTools: `${PILLAR_TOOLS_NO_SKILLS},Bash(git log:*),Bash(git show:*)`,
    })
  })
})
