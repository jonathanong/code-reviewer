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
const CODEX = [...WITH_RULES, '--harness', 'codex', '--model', 'gpt-x', '--reads-outside-checkout']
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

describe('runReviewBenchCli --effort', () => {
  it('runs Claude at the level and labels every output', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli([...WITH_RULES, '--effort', 'high'], h.deps)
    expect(after(h.calls[0]?.[1] ?? [], '--effort')).toBe('high')
    expect(JSON.parse(h.files.get('out/raw/rules/p1.json') as string).effort).toBe('high')
    expect(JSON.parse(h.files.get('out/summary.json') as string)[0].summary.effort).toBe('high')
    const line =
      'Effort: pillar agent at high; not what a review uses, so these rows are not comparable with normal rows.'
    expect(h.files.get('out/summary.md')).toContain(line)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain(line)
  })

  it('runs Codex at the level', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli([...CODEX, '--effort', 'xhigh'], h.deps)
    const args = h.calls[0]?.[1] ?? []
    expect(args).toContain('model_reasoning_effort="xhigh"')
    expect(h.files.get('out/summary.md')).toContain('Effort: pillar agent at xhigh')
    expect(h.files.get('out/summary.md')).toContain('Harness: pillar agent on codex')
  })

  it('labels a --score-only run from the saved results', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli([...WITH_RULES, '--effort', 'low'], h.deps)
    await runReviewBenchCli([...WITH_RULES, '--score-only'], h.deps)
    expect(h.files.get('out/summary.md')).toContain('Effort: pillar agent at low')
  })

  it('writes the default output without the flag and for --effort medium', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const plain = setup()
    await runReviewBenchCli(WITH_RULES, plain.deps)
    const medium = setup()
    await runReviewBenchCli([...WITH_RULES, '--effort', 'medium'], medium.deps)
    expect(after(plain.calls[0]?.[1] ?? [], '--effort')).toBe('medium')
    expect(after(medium.calls[0]?.[1] ?? [], '--effort')).toBe('medium')
    expect(plain.files.get('out/summary.md')).not.toContain('Effort:')
    expect(plain.files.get('out/raw/rules/p1.json')).not.toContain('effort')
    expect(plain.files.get('out/raw/rules/p1.json')).toBe(medium.files.get('out/raw/rules/p1.json'))
    expect(plain.files.get('out/summary.json')).toBe(medium.files.get('out/summary.json'))
  })

  it.each(['max', 'ultra', 'extreme'])(
    'refuses %s before any work, listing the levels',
    async (level) => {
      const h = setup()
      const error = await runReviewBenchCli([...WITH_RULES, '--effort', level], h.deps).catch(
        (e) => e,
      )
      expect(error.message).toContain('--effort')
      expect(error.message).toContain('low, medium, high, xhigh')
      expect(error.message).not.toContain('max.')
      expect(h.calls).toEqual([])
      expect(h.files.has('out/summary.md')).toBe(false)
    },
  )
})
