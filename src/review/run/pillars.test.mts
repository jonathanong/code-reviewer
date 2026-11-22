import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { Pillar } from '../pillar-name.mts'
import { runPillars, type PillarsInput } from './pillars.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const finding = (title: string) => ({ severity: 'high', title, body: 'B', path: 'a.ts', line: 3 })
const answer = (findings: unknown[], cost = 0.5) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: cost,
    num_turns: 4,
    structured_output: { findings },
  })

function setup(exec: Exec, overrides: Partial<PillarsInput> = {}) {
  const out = mkdtempSync(join(tmpdir(), 'pillars-'))
  dirs.push(out)
  const input: PillarsInput = {
    pillars: [
      { pillar: 'rules', model: 'sonnet' },
      { pillar: 'correctness', model: 'sonnet' },
      { pillar: 'history', model: 'haiku' },
    ],
    tree: '/tree',
    run: { out, sinceSha: null, hasRules: true },
    mode: 'full',
    jobs: 2,
    contract: 'CONTRACT',
    readPillar: (pillar: Pillar) => `PILLAR ${pillar}`,
    skills: ['skills:documentation'],
    settings: { enabledPlugins: {} },
    exec,
    ...overrides,
  }
  return { out, input }
}

const promptOf = (call: unknown[]) => (call[1] as string[])[1] as string
const forPillar = (exec: ReturnType<typeof vi.fn>, pillar: string) =>
  exec.mock.calls.filter((call) => promptOf(call).includes(`PILLAR ${pillar}`))

describe('runPillars', () => {
  it('runs each pillar in the checkout and saves its findings, skills, and usage', async () => {
    const exec = vi.fn(async (_command: string, args: string[]) =>
      answer([finding(`from ${args[args.indexOf('--model') + 1]}`)]),
    )
    const { out, input } = setup(exec)
    const results = await runPillars(input)
    expect(results.map((result) => [result.pillar, result.model])).toEqual([
      ['rules', 'sonnet'],
      ['correctness', 'sonnet'],
      ['history', 'haiku'],
    ])
    expect(results[2]?.findings[0]).toMatchObject({ pillar: 'history', title: 'from haiku' })
    expect(results[0]?.usage?.costUsd).toBe(0.5)
    const saved = JSON.parse(readFileSync(join(out, 'pillars', 'rules.json'), 'utf8'))
    expect(saved).toMatchObject({
      pillar: 'rules',
      model: 'sonnet',
      skills: [],
      failedAttempts: [],
    })
    const [command, args, options] = exec.mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string; timeoutMs: number },
    ]
    expect(command).toBe('claude')
    expect(options.cwd).toBe('/tree')
    expect(args[args.indexOf('--effort') + 1]).toBe('medium')
    expect(args[args.indexOf('--add-dir') + 1]).toBe(out)
    expect(args).toContain('--settings')
    expect(promptOf(exec.mock.calls[0] as unknown[])).toContain('call the Skill tool')
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob,Agent,Skill')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob,Agent,Skill')
  })

  it('tells only the rules pillar to load the selected skills', async () => {
    const exec = vi.fn(async (_command: string, _args: string[]) => answer([]))
    await runPillars(setup(exec).input)
    const forced = (pillar: string) =>
      forPillar(exec, pillar).some((call) => promptOf(call).includes('call the Skill tool once'))
    expect(forced('rules')).toBe(true)
    expect(forced('correctness')).toBe(false)
    expect(forced('history')).toBe(false)
  })

  it('lets only the history pillar read git history through the shell', async () => {
    const exec = vi.fn(async (_command: string, _args: string[]) => answer([]))
    await runPillars(setup(exec).input)
    const args = (forPillar(exec, 'history')[0] as unknown as [string, string[]])[1]
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob,Agent,Skill,Bash')
    expect(args[args.indexOf('--allowedTools') + 1]).toBe(
      'Read,Grep,Glob,Agent,Skill,Bash(git log:*),Bash(git show:*)',
    )
  })

  describe('web references', () => {
    const web = {
      sources: [{ name: 'aws', description: 'AWS docs', domains: ['docs.aws.amazon.com'] }],
      guidance: 'WEB RULES',
    }
    const ALL: PillarsInput['pillars'] = [
      { pillar: 'rules', model: 'sonnet' },
      { pillar: 'correctness', model: 'sonnet' },
      { pillar: 'security', model: 'sonnet' },
      { pillar: 'history', model: 'haiku' },
    ]
    const argsOf = async (overrides: Partial<PillarsInput>) => {
      const exec = vi.fn(async (_command: string, _args: string[]) => answer([]))
      await runPillars(setup(exec, { pillars: ALL, ...overrides }).input)
      return exec
    }
    const normal = (exec: ReturnType<typeof vi.fn>) =>
      JSON.stringify(exec.mock.calls).replace(/pillars-[A-Za-z0-9]+/gu, 'RUN')
    const flag = (call: unknown, name: string) => {
      const args = (call as [string, string[]])[1]
      return args[args.indexOf(name) + 1]
    }

    it('gives only correctness and security the block, WebFetch for the domains, and no settings file', async () => {
      const exec = await argsOf({ web })
      for (const pillar of ['correctness', 'security']) {
        const [call] = forPillar(exec, pillar)
        expect(promptOf(call as unknown[])).toContain(
          `PILLAR ${pillar}\n\n## References\n\nYou have the WebFetch tool for these hosts only`,
        )
        expect(promptOf(call as unknown[])).toContain('WEB RULES')
        expect(flag(call, '--tools')).toBe('Read,Grep,Glob,Agent,Skill,WebFetch')
        expect(flag(call, '--allowedTools')).toBe(
          'Read,Grep,Glob,Agent,Skill,WebFetch(domain:docs.aws.amazon.com)',
        )
        expect(flag(call, '--setting-sources')).toBe('')
      }
      for (const pillar of ['rules', 'history']) {
        const [call] = forPillar(exec, pillar)
        expect(promptOf(call as unknown[])).not.toContain('References')
        expect(flag(call, '--allowedTools')).not.toContain('WebFetch')
      }
      expect(flag(forPillar(exec, 'rules')[0], '--setting-sources')).toBe('user')
    })

    it('changes no prompt or flag when none is configured', async () => {
      const plain = await argsOf({})
      const empty = await argsOf({ web: { sources: [], guidance: 'X' } })
      expect(normal(empty)).toBe(normal(plain))
      expect(normal(plain)).not.toContain('WebFetch')
    })
  })

  it('keeps the cost of an answer that fails validation', async () => {
    let tries = 0
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if ((args[1] as string).includes('PILLAR rules')) {
        tries += 1
        if (tries === 1) return answer([{ ...finding('x'), title: '' }], 0.25)
      }
      return answer([])
    })
    const results = await runPillars(setup(exec).input)
    expect(results[0]?.error).toBeUndefined()
    expect(results[0]?.failedAttempts).toHaveLength(1)
    expect(results[0]?.failedAttempts[0]?.usage?.costUsd).toBe(0.25)
  })

  it('uses low effort for a light plan and omits plugin settings when unknown', async () => {
    const exec = vi.fn(async () => answer([]))
    const { input } = setup(exec, { mode: 'light' })
    const { settings: _settings, ...withoutSettings } = input
    await runPillars(withoutSettings)
    const args = (exec.mock.calls[0] as unknown as [string, string[]])[1]
    expect(args[args.indexOf('--effort') + 1]).toBe('low')
    expect(args).not.toContain('--settings')
  })

  it('never runs more than `jobs` pillars at once', async () => {
    let active = 0
    let peak = 0
    const exec: Exec = async () => {
      active += 1
      peak = Math.max(peak, active)
      await Promise.resolve()
      await Promise.resolve()
      active -= 1
      return answer([])
    }
    await runPillars(setup(exec, { jobs: 2 }).input)
    expect(peak).toBe(2)
  })

  it('retries a failed pillar once and keeps the cost of the failed attempt', async () => {
    let tries = 0
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if ((args[1] as string).includes('PILLAR rules')) {
        tries += 1
        if (tries === 1) throw new Error('claude crashed')
      }
      return answer([])
    })
    const results = await runPillars(setup(exec).input)
    expect(forPillar(exec, 'rules')).toHaveLength(2)
    expect(results[0]?.error).toBeUndefined()
    expect(results[0]?.failedAttempts).toEqual([{ error: 'claude crashed', usage: null }])
  })

  it('records the error after the retry fails too', async () => {
    const exec = vi.fn(async (_command: string, args: string[]) => {
      if ((args[1] as string).includes('PILLAR history')) return 'not json'
      return answer([])
    })
    const { out, input } = setup(exec)
    const results = await runPillars(input)
    expect(forPillar(exec, 'history')).toHaveLength(2)
    const history = results[2]
    expect(history).toMatchObject({
      pillar: 'history',
      findings: [],
      usage: null,
      error: 'Pillar run did not print JSON.',
    })
    expect(history?.failedAttempts).toHaveLength(2)
    expect(JSON.parse(readFileSync(join(out, 'pillars', 'history.json'), 'utf8')).error).toBe(
      'Pillar run did not print JSON.',
    )
  })
})
