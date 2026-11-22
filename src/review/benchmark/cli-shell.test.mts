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
    expected: [{ pillar: 'correctness', severity: 'high', path: 'a.ts', lines: null, claim: 'c' }],
  },
]
const ARGS = ['--cases', 'cases.json', '--out', 'out', '--prompts', 'prompts']
const PILLAR = [...ARGS, '--pillar', 'correctness']

function setup() {
  const files = new Map([
    ['cases.json', JSON.stringify(CASES)],
    ['prompts/correctness.md', 'C'],
    ['/snap/p1/.review/pr.md', '# T'],
  ])
  const calls: Array<[string, string[]]> = []
  const deps: PillarBenchDeps = {
    exec: async (command, args) => {
      if (args[0] === 'plugin') return '[]'
      calls.push([command, args])
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

describe('runReviewBenchCli --shell', () => {
  it('grants the prefixes to the pillar run and labels every output', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli([...PILLAR, '--shell', 'git grep', '--shell', 'rg'], h.deps)
    const args = h.calls[0]?.[1] ?? []
    expect(args[args.indexOf('--allowedTools') + 1]).toContain('Bash(git grep:*),Bash(rg:*)')
    expect(JSON.parse(h.files.get('out/raw/correctness/p1.json') as string).shell).toEqual([
      'git grep',
      'rg',
    ])
    const summary = JSON.parse(h.files.get('out/summary.json') as string)
    expect(summary[0].summary.shell).toEqual(['git grep', 'rg'])
    const markdown = h.files.get('out/summary.md') as string
    expect(markdown).toContain('Shell granted to the pillar agent: git grep, rg.')
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('Shell granted')
  })

  it('keeps the label on a --score-only run from the saved results', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli([...PILLAR, '--shell', 'rg'], h.deps)
    await runReviewBenchCli([...PILLAR, '--score-only'], h.deps)
    expect(h.files.get('out/summary.md')).toContain('Shell granted to the pillar agent: rg.')
  })

  it('leaves a normal run without shell, in the argv, the results and the summary', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli(PILLAR, h.deps)
    expect(h.calls[0]?.[1]).not.toContain('Bash')
    expect(h.files.get('out/raw/correctness/p1.json')).not.toContain('shell')
    expect(h.files.get('out/summary.md')).not.toContain('Shell granted')
    expect(h.files.get('out/summary.json')).not.toContain('"shell"')
  })

  it('stops before any work on an empty prefix, shell syntax, or a non-Claude harness', async () => {
    const h = setup()
    await expect(runReviewBenchCli([...PILLAR, '--shell', ''], h.deps)).rejects.toThrow(
      'bench --shell',
    )
    await expect(runReviewBenchCli([...PILLAR, '--shell', 'rg; ls'], h.deps)).rejects.toThrow(
      'bench --shell',
    )
    await expect(
      runReviewBenchCli(
        [...PILLAR, '--shell', 'rg', '--harness', 'codex', '--model', 'gpt-x'],
        h.deps,
      ),
    ).rejects.toThrow('bench --shell needs --harness claude')
    expect(h.calls).toEqual([])
  })
})
