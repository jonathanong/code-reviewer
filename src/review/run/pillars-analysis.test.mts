import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ExtraPillar } from '../pillar-name.mts'
import { runPillars, type PillarsInput } from './pillars.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const answer = JSON.stringify({
  type: 'result',
  total_cost_usd: 0,
  num_turns: 1,
  structured_output: { findings: [] },
})

async function run(
  analysis?: { commands: string[]; section: string },
  more: Partial<PillarsInput> = {},
) {
  const out = mkdtempSync(join(tmpdir(), 'pillars-analysis-'))
  dirs.push(out)
  const exec = vi.fn(async (_command: string, _args: string[]) => answer)
  await runPillars({
    pillars: [
      { pillar: 'rules', model: 'sonnet' },
      { pillar: 'history', model: 'haiku' },
    ],
    tree: '/tree',
    run: { out, sinceSha: null, hasRules: true },
    mode: 'light',
    jobs: 1,
    contract: 'CONTRACT',
    readPillar: (pillar) => `PILLAR ${pillar}`,
    skills: [],
    exec,
    ...(analysis === undefined ? {} : { analysis }),
    ...more,
  })
  return exec.mock.calls.map((call) => call[1])
}

const flag = (args: string[], name: string) => args[args.indexOf(name) + 1]

describe('runPillars analysis', () => {
  const analysis = { commands: ['graph dependents'], section: 'ANALYSIS SECTION' }

  it('adds the commands and the section to every pillar and keeps the history git grant', async () => {
    const [rules, history] = await run(analysis)
    expect(rules?.[1]).toMatch(/\n\nANALYSIS SECTION$/u)
    expect(flag(rules as string[], '--allowedTools')).toBe(
      'Read,Grep,Glob,Agent,Skill,Bash(graph dependents:*)',
    )
    expect(history?.[1]).toMatch(/\n\nANALYSIS SECTION$/u)
    expect(flag(history as string[], '--allowedTools')).toBe(
      'Read,Grep,Glob,Agent,Skill,Bash(git log:*),Bash(git show:*),Bash(graph dependents:*)',
    )
  })

  it('grants no shell to a pillar other than history without analysis', async () => {
    const [rules] = await run()
    expect(flag(rules as string[], '--tools')).toBe('Read,Grep,Glob,Agent,Skill')
    expect(rules?.[1]).not.toContain('ANALYSIS')
  })

  it('keeps a configured pillar without shell, since its instructions may come from the repository', async () => {
    const name = 'extra-one' as ExtraPillar
    const [extra] = await run(analysis, {
      pillars: [{ pillar: name, model: 'sonnet' }],
      extra: [{ name, modes: ['light'], source: { prompt: 'EXTRA' } }],
    })
    expect(extra?.[1]).not.toContain('ANALYSIS')
    expect(flag(extra as string[], '--tools')).toBe('Read,Grep,Glob,Agent,Skill')
  })
})
