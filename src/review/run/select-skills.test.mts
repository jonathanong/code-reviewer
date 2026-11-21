import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../benchmark/exec.mts'
import { DEFAULT_RULE_PLUGINS, type PluginInstall } from '../plugins.mts'
import {
  SKILL_SELECTION_SCHEMA,
  buildSelectionPrompt,
  listRuleSkillFiles,
  listRuleSkills,
  selectSkills,
} from './select-skills.mts'

const path = (name: string) => fileURLToPath(new URL(`./fixtures/plugins/${name}`, import.meta.url))
const INSTALLS: PluginInstall[] = [
  { name: 'jong-skills', installPath: path('skills') },
  { name: 'no-mistakes-rules', installPath: path('no-mistakes-rules') },
  { name: 'other', installPath: path('other') },
]

const answer = (skills: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0.01, structured_output: { skills } })

describe('listRuleSkills', () => {
  it('reads name and description from the rule plugins only, naming each plugin:skill', () => {
    expect(listRuleSkills(INSTALLS, DEFAULT_RULE_PLUGINS)).toEqual([
      { name: 'jong-skills:bare', description: '' },
      { name: 'jong-skills:documentation', description: 'Decide what belongs in docs.' },
      { name: 'no-mistakes-rules:git-rules', description: 'Rules for git and pull requests.' },
      {
        name: 'no-mistakes-rules:typescript-rules',
        description: 'MUST NOT rules for TypeScript and Node.js. Use when writing TS.',
      },
    ])
  })

  it('also gives the absolute SKILL.md path of each skill', () => {
    expect(listRuleSkillFiles(INSTALLS, ['no-mistakes-rules']).map((skill) => skill.file)).toEqual([
      path('no-mistakes-rules/skills/git-rules/SKILL.md'),
      path('no-mistakes-rules/skills/typescript-rules/SKILL.md'),
    ])
  })

  it('skips a SKILL.md that cannot be read and says so when asked, else throws', () => {
    const installs = [
      {
        name: 'broken',
        installPath: fileURLToPath(new URL('../context/fixtures/unreadable', import.meta.url)),
      },
    ]
    const unreadable: string[] = []
    expect(listRuleSkillFiles(installs, ['broken'], unreadable)).toEqual([])
    expect(unreadable).toHaveLength(1)
    expect(unreadable[0]).toContain('broken:broken could not be read')
    expect(() => listRuleSkillFiles(installs, ['broken'])).toThrow()
  })

  it('lists the skills of the configured plugins only', () => {
    expect(listRuleSkills(INSTALLS, ['no-mistakes-rules']).map((skill) => skill.name)).toEqual([
      'no-mistakes-rules:git-rules',
      'no-mistakes-rules:typescript-rules',
    ])
    expect(listRuleSkills(INSTALLS, [])).toEqual([])
  })

  it('offers nothing for a plugin that is not installed or has no skills directory', () => {
    expect(listRuleSkills([], DEFAULT_RULE_PLUGINS)).toEqual([])
    expect(
      listRuleSkills([{ name: 'jong-skills', installPath: path('missing') }], DEFAULT_RULE_PLUGINS),
    ).toEqual([])
  })
})

describe('selectSkills', () => {
  const skills = listRuleSkills(INSTALLS, DEFAULT_RULE_PLUGINS)
  const base = { title: 'Add widget', index: '- a.ts', skills, cwd: '/tree' }

  it('asks Haiku with no tools and keeps only offered names, once each', async () => {
    const exec = vi.fn(async () =>
      answer(['jong-skills:documentation', 'made:up', 'jong-skills:documentation', 7]),
    )
    const settings = { enabledPlugins: { 'jong-skills@m': true } }
    const choice = await selectSkills({ ...base, settings, exec })
    expect(choice.selected).toEqual(['jong-skills:documentation'])
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
    expect(prompt).toContain('- jong-skills:documentation: Decide what belongs in docs.')
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
    expect(failing).toHaveBeenCalledTimes(2)
    expect(choice.error).toContain('error_max_turns')
    expect(choice.usage?.costUsd).toBe(0.4)
  })

  it('tries a failed call once more and uses the second answer', async () => {
    let calls = 0
    const flaky = async () => {
      calls += 1
      if (calls === 1) throw new ExecError('claude exited with 1', 1, '', undefined)
      return answer(['jong-skills:documentation'])
    }
    const choice = await selectSkills({ ...base, exec: flaky })
    expect(choice.error).toBeUndefined()
    expect(choice.selected).toEqual(['jong-skills:documentation'])
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

  it('selects nothing and calls no model when no rule plugins are configured', async () => {
    const exec = vi.fn(async () => answer(['jong-skills:documentation']))
    const choice = await selectSkills({ ...base, skills: [], rulePlugins: [], exec })
    expect(choice).toEqual({ selected: [], available: 0, usage: null })
    expect(exec).not.toHaveBeenCalled()
  })

  it('still fails when configured plugins yield no skills', async () => {
    const exec = vi.fn(async () => answer([]))
    const choice = await selectSkills({ ...base, skills: [], rulePlugins: ['jong-skills'], exec })
    expect(choice.error).toBe('No rule skills are installed.')
    expect(exec).not.toHaveBeenCalled()
  })

  it('runs without plugin settings when none are given', async () => {
    const exec = vi.fn(async () => answer([]))
    await selectSkills({ ...base, exec })
    expect((exec.mock.calls[0] as unknown as [string, string[]])[1]).not.toContain('--settings')
  })
})
