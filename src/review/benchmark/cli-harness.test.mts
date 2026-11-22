import { writeFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { runReviewBenchCli, type PillarBenchDeps } from './cli.mts'

const CASES = [
  {
    id: 'p1',
    repo: 'acme/widgets',
    pr: 1,
    title: 'p1',
    baseSha: 'a'.repeat(40),
    headSha: 'b'.repeat(40),
    kind: 'positive',
    reason: '',
    expected: [{ pillar: 'rules', severity: 'high', path: 'a.ts', lines: null, claim: 'c' }],
    expectedSkills: ['p:s'],
  },
]
const BASE = ['--cases', 'cases.json', '--out', 'out', '--prompts', 'prompts']
const WITH_RULES = [...BASE, '--pillar', 'rules']
const GRANT = ['--harness', 'codex', '--model', 'gpt-x', '--reads-outside-checkout']
const CODEX = [...WITH_RULES, ...GRANT]
const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1] ?? ''

function setup() {
  const files = new Map([
    ['cases.json', JSON.stringify(CASES)],
    ['prompts/rules.md', 'R'],
    ['prompts/history.md', 'H'],
    ['/snap/p1/.review/pr.md', '# T'],
  ])
  const calls: Array<[string, string[]]> = []
  const deps: PillarBenchDeps = {
    exec: async (command, args) => {
      if (args[0] === 'plugin') return '[]'
      calls.push([command, args])
      if (command === 'codex') {
        writeFileSync(after(args, '-o'), JSON.stringify({ findings: [] }))
        return JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 3 } })
      }
      return JSON.stringify({ structured_output: { findings: [] } })
    },
    readFile: (path) => files.get(path) as string,
    writeFile: (path, text) => void files.set(path, text),
    exists: (path) => files.has(path),
    log: () => {},
    prepare: async (item) => ({ dir: `/snap/${item.id}`, diff: '', body: '' }),
    cwd: () => '/work',
    selection: {
      skills: () => [],
      select: async () => ({ selected: [], available: 0, usage: null }),
    },
    stageRules: async () => 'digest',
  }
  return { deps, files, calls }
}

afterEach(() => vi.restoreAllMocks())

describe('runReviewBenchCli --harness', () => {
  it('runs the pillar on Codex and labels every output', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli(CODEX, h.deps)
    expect(h.calls.map(([command]) => command)).toEqual(['codex'])
    expect(JSON.parse(h.files.get('out/raw/rules/p1.json') as string).harness).toBe('codex')
    const summary = JSON.parse(h.files.get('out/summary.json') as string)
    expect(summary[0].summary.harness).toBe('codex')
    const markdown = h.files.get('out/summary.md') as string
    expect(markdown).toContain('Harness: pillar agent on codex, model gpt-x')
    expect(markdown).toContain('| not reported | not reported |')
    expect(markdown).toContain('| 1 | - | - |')
    expect(markdown).not.toContain('$0')
    expect(markdown).not.toContain('missing p:s')
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('Harness: pillar agent on codex')
  })

  it('labels a --score-only run from the saved results', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli(CODEX, h.deps)
    await runReviewBenchCli([...WITH_RULES, '--score-only'], h.deps)
    expect(h.files.get('out/summary.md')).toContain('Harness: pillar agent on codex')
  })

  it('leaves a Claude run unlabeled, with or without the flag', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli([...WITH_RULES, '--harness', 'claude'], h.deps)
    expect(h.calls[0]?.[0]).toBe('claude')
    expect(h.files.get('out/summary.md')).not.toContain('Harness:')
    expect(h.files.get('out/summary.md')).toContain('missing p:s')
    const saved = JSON.parse(h.files.get('out/summary.json') as string)
    expect(saved[0].summary).not.toHaveProperty('harness')
    expect(h.files.get('out/raw/rules/p1.json')).not.toContain('harness')
  })

  it('stops before any work on an unknown harness, listing the registered names', async () => {
    const h = setup()
    const error = await runReviewBenchCli([...WITH_RULES, '--harness', 'nope'], h.deps).catch(
      (e) => e,
    )
    expect(error.message).toContain('--harness')
    for (const name of ['claude', 'codex', 'grok', 'opencode'])
      expect(error.message).toContain(name)
    expect(h.calls).toEqual([])
  })

  it('needs --model for another harness', async () => {
    const h = setup()
    await expect(runReviewBenchCli([...WITH_RULES, '--harness', 'codex'], h.deps)).rejects.toThrow(
      '--harness codex needs --model',
    )
    expect(h.calls).toEqual([])
  })

  it('stops before any model call when the adapter refuses without the grant', async () => {
    const h = setup()
    const error = await runReviewBenchCli(
      [...WITH_RULES, '--harness', 'codex', '--model', 'gpt-x'],
      h.deps,
    ).catch((e) => e)
    expect(error.message).toContain('--harness codex cannot run the rules pillar')
    expect(error.cause).toBeInstanceOf(Error)
    expect(h.calls).toEqual([])
  })

  it('names the history pillar when the adapter refuses its shell grant', async () => {
    const h = setup()
    const error = await runReviewBenchCli([...BASE, '--pillar', 'history', ...GRANT], h.deps).catch(
      (e) => e,
    )
    expect(error.message).toContain('cannot run the history pillar')
    expect(h.calls).toEqual([])
  })

  it('rejects --loads-only on another harness', async () => {
    const h = setup()
    await expect(runReviewBenchCli([...CODEX, '--loads-only'], h.deps)).rejects.toThrow(
      '--loads-only needs --harness claude',
    )
  })

  it('rejects --reads-outside-checkout without a non-Claude harness', async () => {
    const h = setup()
    await expect(
      runReviewBenchCli([...WITH_RULES, '--reads-outside-checkout'], h.deps),
    ).rejects.toThrow('needs --harness')
    await expect(
      runReviewBenchCli([...WITH_RULES, '--harness', 'claude', '--reads-outside-checkout'], h.deps),
    ).rejects.toThrow('non-Claude')
  })
})
