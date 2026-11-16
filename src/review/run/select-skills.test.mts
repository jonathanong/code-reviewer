import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../benchmark/exec.mts'
import type { PluginInstall } from '../plugins.mts'
import {
  SKILL_SELECTION_SCHEMA,
  buildSelectionPrompt,
  listRuleSkills,
  MAX_SELECTED,
  selectSkills,
} from './select-skills.mts'

const path = (name: string) => fileURLToPath(new URL(`./fixtures/plugins/${name}`, import.meta.url))
const INSTALLS: PluginInstall[] = [
  { name: 'skills', installPath: path('skills') },
  { name: 'no-mistakes-rules', installPath: path('no-mistakes-rules') },
  { name: 'other', installPath: path('other') },
]

const answer = (skills: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0.01, structured_output: { skills } })

describe('listRuleSkills', () => {
  it('reads name and description from the rule plugins only, naming each plugin:skill', () => {
    expect(listRuleSkills(INSTALLS)).toEqual([
      { name: 'no-mistakes-rules:git-rules', description: 'Rules for git and pull requests.' },
      {
        name: 'no-mistakes-rules:typescript-rules',
        description: 'MUST NOT rules for TypeScript and Node.js. Use when writing TS.',
      },
      { name: 'skills:bare', description: '' },
      { name: 'skills:documentation', description: 'Decide what belongs in docs.' },
    ])
  })

  it('offers nothing for a plugin that is not installed or has no skills directory', () => {
    expect(listRuleSkills([])).toEqual([])
    expect(listRuleSkills([{ name: 'skills', installPath: path('missing') }])).toEqual([])
  })
})

describe('selectSkills', () => {
  const skills = listRuleSkills(INSTALLS)
  const base = { title: 'Add widget', index: '- a.ts', skills, cwd: '/tree' }

  it('keeps the first MAX_SELECTED names, which the prompt asks for most relevant first', async () => {
    const many = Array.from({ length: MAX_SELECTED + 3 }, (_, i) => ({
      name: `skills:s${i}`,
      description: '',
    }))
    const exec = vi.fn(async () => answer(many.map((skill) => skill.name)))
    const choice = await selectSkills({ ...base, skills: many, exec })
    expect(choice.selected).toEqual(many.slice(0, MAX_SELECTED).map((skill) => skill.name))
    expect(buildSelectionPrompt('t', 'i', many)).toContain(`return at most ${MAX_SELECTED}`)
  })

  it('asks Haiku with no tools and keeps only offered names, once each', async () => {
    const exec = vi.fn(async () =>
      answer(['skills:documentation', 'made:up', 'skills:documentation', 7]),
    )
    const settings = { enabledPlugins: { 'skills@m': true } }
    const choice = await selectSkills({ ...base, settings, exec })
    expect(choice.selected).toEqual(['skills:documentation'])
    expect(choice.available).toBe(4)
    expect(choice.usage?.costUsd).toBe(0.01)
    expect(choice.error).toBeUndefined()
    const [command, args, options] = exec.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; timeoutMs: number },
    ]
    expect(command).toBe('claude')
    expect(args[args.indexOf('--model') + 1]).toBe('haiku')
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).toContain('--strict-mcp-config')
    expect(JSON.parse(args[args.indexOf('--settings') + 1] as string)).toEqual(settings)
    expect(JSON.parse(args[args.indexOf('--json-schema') + 1] as string)).toEqual(
      SKILL_SELECTION_SCHEMA,
    )
    expect(args[1]).toBe(buildSelectionPrompt('Add widget', '- a.ts', skills))
    expect(options.cwd).toBe('/tree')
    expect(options.timeoutMs).toBeGreaterThan(0)
  })

  it('lists every skill with its description and clips a long index', () => {
    expect(buildSelectionPrompt('T', 'i', skills)).not.toContain('## Diff excerpt')
    expect(buildSelectionPrompt('T', 'i', skills, '+added line')).toContain(
      '## Diff excerpt\n\n+added line',
    )
    const prompt = buildSelectionPrompt('T', 'x'.repeat(30_000), skills)
    expect(prompt).toContain('- skills:documentation: Decide what belongs in docs.')
    expect(prompt).toContain('Pull request title: T')
    expect(prompt.length).toBeLessThan(26_000)
  })

  it('continues with no selection and records the error when the call fails', async () => {
    const failing = vi.fn(async () => {
      throw new ExecError(
        'claude exited with 1',
        1,
        JSON.stringify({ type: 'result', subtype: 'error_max_turns', total_cost_usd: 0.2 }),
        undefined,
      )
    })
    const choice = await selectSkills({ ...base, exec: failing })
    expect(choice.selected).toEqual([])
    expect(choice.error).toContain('error_max_turns')
    expect(choice.usage?.costUsd).toBe(0.2)
  })

  it('records an answer without a skills list', async () => {
    const choice = await selectSkills({ ...base, exec: async () => answer('none') })
    expect(choice).toMatchObject({ selected: [], error: 'No skills returned.' })
  })

  it('skips the call when no rule skills are installed', async () => {
    const exec = vi.fn(async () => answer([]))
    const choice = await selectSkills({ ...base, skills: [], exec })
    expect(choice).toEqual({
      selected: [],
      available: 0,
      error: 'No rule skills are installed.',
      usage: null,
    })
    expect(exec).not.toHaveBeenCalled()
  })

  it('runs without plugin settings when none are given', async () => {
    const exec = vi.fn(async () => answer([]))
    await selectSkills({ ...base, exec })
    expect((exec.mock.calls[0] as unknown as [string, string[]])[1]).not.toContain('--settings')
  })
})
