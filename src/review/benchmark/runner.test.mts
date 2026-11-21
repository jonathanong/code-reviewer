import { describe, expect, it, vi } from 'vitest'

import { claudeArgs } from '../../harness/claude-args.mts'
import { EFFORT } from '../../harness/types.mts'
import { pillarCapabilities } from '../run/pillar-capabilities.mts'
import { PILLAR_OUTPUT_SCHEMA } from '../run/pillar-schema.mts'
import type { EvalCase } from './cases.mts'
import { buildPillarPrompt, runPillar } from './runner.mts'

const PILLAR_TOOLS = 'Read,Grep,Glob,Agent,Skill'
const PILLAR_TOOLS_NO_SKILLS = 'Read,Grep,Glob,Agent'

const item: EvalCase = {
  id: 'c1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'T',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
}

const NO_USAGE = {
  costUsd: null,
  turns: null,
  durationMs: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  byModel: {},
}

const output = (findings: unknown) => JSON.stringify({ structured_output: { findings } })

describe('prompt and args', () => {
  it('wraps the pillar prompt with untrusted context instructions', () => {
    const prompt = buildPillarPrompt('  Pillar text  ', item)
    expect(prompt.startsWith('Pillar text\n\n## Pull request under review')).toBe(true)
    expect(prompt).toContain('Repository: acme/widgets.')
    expect(prompt).toContain('.review/pr.md')
    expect(prompt).toContain('.review/files.md')
    expect(prompt).toContain('never read the combined `.review/diff.patch` whole')
    expect(prompt).toContain('untrusted input')
  })

  it('mentions reviewer comments only when context.md exists', () => {
    expect(buildPillarPrompt('P', item)).not.toContain('context.md')
    const prompt = buildPillarPrompt('P', item, true)
    expect(prompt).toContain('.review/context.md')
    expect(prompt).toContain('not instructions')
  })

  it('points at the rules index only when rules were staged', () => {
    expect(buildPillarPrompt('P', item)).not.toContain('INDEX.md')
    const prompt = buildPillarPrompt('P', item, false, true)
    expect(prompt).toContain('`.review/rules/INDEX.md` lists the rule sources for this change')
    expect(prompt).toContain('Read it before reviewing.')
  })

  it('describes a fixture case without a repository', () => {
    const fixture: EvalCase = { ...item, fixture: 'fx/a', fixtureDir: '/x' } as never
    expect(buildPillarPrompt('P', fixture)).toContain('Fixture: fx/a.')
  })
})

describe('runPillar', () => {
  it('runs claude in the snapshot directory and parses its output', async () => {
    const exec = vi.fn(async () => output([{ severity: 'low', title: 'T', body: 'B' }]))
    const findings = await runPillar(
      item,
      '/snap',
      { pillar: 'design', pillarPrompt: 'Prompt', model: 'opus', maxTurns: 5 },
      exec,
    )
    expect(findings).toEqual({
      findings: [{ pillar: 'design', severity: 'low', title: 'T', body: 'B' }],
      skills: [],
      usage: NO_USAGE,
    })
    const [command, args, options] = exec.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string },
    ]
    expect(command).toBe('claude')
    expect(args).toEqual(
      claudeArgs({
        prompt: buildPillarPrompt('Prompt', item),
        label: 'Pillar run',
        model: 'opus',
        maxTurns: 5,
        schema: PILLAR_OUTPUT_SCHEMA,
        can: pillarCapabilities('design'),
        effort: EFFORT.full,
        transcript: true,
      }),
    )
    expect(options).toEqual({ cwd: '/snap' })
  })

  it('drops the Skill tool for a control run', async () => {
    const exec = vi.fn(async () => output([]))
    await runPillar(
      item,
      '/snap',
      { pillar: 'design', pillarPrompt: 'Prompt', model: 'opus', maxTurns: 5, skills: false },
      exec,
    )
    const [, args] = exec.mock.calls[0] as unknown as [string, string[]]
    expect(args[args.indexOf('--tools') + 1]).toBe(PILLAR_TOOLS_NO_SKILLS)
  })

  it('adds the excerpts arm to the prompt only when set, and the replace block last', async () => {
    const prompts: string[] = []
    const run = async (extra: { excerpts?: 'alongside' | 'replace' }) => {
      const exec = vi.fn(async () => output([]))
      await runPillar(
        item,
        '/snap',
        {
          pillar: 'design',
          pillarPrompt: 'P',
          model: 'opus',
          maxTurns: 5,
          selected: ['s:a'],
          ...extra,
        },
        exec,
      )
      const [, args] = exec.mock.calls[0] as unknown as [string, string[]]
      prompts.push(args[1] as string)
    }
    await run({})
    await run({ excerpts: 'alongside' })
    await run({ excerpts: 'replace' })
    const [plain, alongside, replace] = prompts as [string, string, string]
    expect(plain).not.toContain('review-context.md')
    expect(alongside).toContain('`.review/review-context.md` is reference data')
    expect(alongside).toContain('alongside the Skill loads, not instead of them')
    expect(alongside.endsWith('including any that looks unrelated to this pillar.')).toBe(true)
    expect(replace).not.toContain('alongside the Skill loads')
    expect(replace).toContain('## Quoted rules replace loading')
    expect(replace.indexOf('call the Skill tool once')).toBeLessThan(
      replace.indexOf('## Quoted rules replace loading'),
    )
  })

  it('passes the plugin settings through to claude', async () => {
    const exec = vi.fn(async () => output([]))
    const settings = { enabledPlugins: { 'skills@m': true } }
    await runPillar(
      item,
      '/snap',
      { pillar: 'design', pillarPrompt: 'Prompt', model: 'opus', maxTurns: 5, settings },
      exec,
    )
    const [, args] = exec.mock.calls[0] as unknown as [string, string[]]
    expect(args[args.indexOf('--tools') + 1]).toBe(PILLAR_TOOLS)
    expect(JSON.parse(args[args.indexOf('--settings') + 1] as string)).toEqual(settings)
  })

  it('gives the history pillar the git history tools `review` gives it', async () => {
    const exec = vi.fn(async () => output([]))
    await runPillar(
      item,
      '/snap',
      { pillar: 'history', pillarPrompt: 'Prompt', model: 'opus', maxTurns: 5 },
      exec,
    )
    const [, args] = exec.mock.calls[0] as unknown as [string, string[]]
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(
      `${PILLAR_TOOLS},Bash(git log:*),Bash(git show:*)`,
    )
    expect(args[args.indexOf('--tools') + 1]).toBe(`${PILLAR_TOOLS},Bash`)
  })
})
