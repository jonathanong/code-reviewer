import { afterEach, describe, expect, it, vi } from 'vitest'

import { runReviewBenchCli, type PillarBenchDeps } from './cli.mts'

const expected = [
  { pillar: 'correctness', severity: 'high', path: 'a.ts', lines: null, claim: 'c' },
]
const CASES = ['p1', 'p2'].map((id) => ({
  id,
  repo: 'acme/widgets',
  pr: 1,
  title: id,
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'positive',
  reason: '',
  expected,
}))
const ARGS = ['--cases', 'cases.json', '--out', 'out', '--prompts', 'prompts']
const PILLAR = [...ARGS, '--pillar', 'correctness']

function setup(failOn?: string) {
  const files = new Map([
    ['cases.json', JSON.stringify(CASES)],
    ['prompts/correctness.md', 'C'],
    ['/snap/p1/.review/pr.md', '# T'],
    ['/snap/p2/.review/pr.md', '# T'],
  ])
  const prepared: Array<[string, readonly string[] | undefined]> = []
  const staged: string[] = []
  const models: string[] = []
  const deps: PillarBenchDeps = {
    exec: async (_command, args) => {
      if (args[0] === 'plugin') return '[]'
      models.push(args.join(' '))
      return JSON.stringify({ structured_output: { findings: [] } })
    },
    readFile: (path) => files.get(path) as string,
    writeFile: (path, text) => void files.set(path, text),
    exists: (path) => files.has(path),
    log: () => {},
    prepare: async (item, _cache, _work, _exec, onlyPath) => {
      if (item.id === failOn) throw new Error(`bench --only-path: case ${item.id} changes none`)
      prepared.push([item.id, onlyPath])
      return { dir: `/snap/${item.id}`, diff: '', body: '' }
    },
    cwd: () => '/work',
    selection: {
      skills: () => [],
      select: async () => ({ selected: [], available: 0, usage: null }),
    },
    stageRules: async (item) => {
      staged.push(item.id)
      return 'digest'
    },
  }
  return { deps, files, prepared, staged, models }
}

afterEach(() => vi.restoreAllMocks())

describe('runReviewBenchCli --only-path', () => {
  it('passes the normalized paths to every snapshot and labels every output', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli(
      [...PILLAR, '--only-path', './src/a.ts', '--only-path', 'src/b.ts'],
      h.deps,
    )
    expect(h.prepared).toEqual([
      ['p1', ['src/a.ts', 'src/b.ts']],
      ['p2', ['src/a.ts', 'src/b.ts']],
    ])
    expect(JSON.parse(h.files.get('out/raw/correctness/p1.json') as string).onlyPath).toEqual([
      'src/a.ts',
      'src/b.ts',
    ])
    const summary = JSON.parse(h.files.get('out/summary.json') as string)
    expect(summary[0].summary.onlyPath).toEqual(['src/a.ts', 'src/b.ts'])
    expect(h.files.get('out/summary.md')).toContain(
      'Diff shown to the pillar agent: only src/a.ts, src/b.ts.',
    )
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain('not comparable with normal rows')
  })

  it('keeps the label on a --score-only run from the saved results', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli([...PILLAR, '--only-path', 'a.ts'], h.deps)
    await runReviewBenchCli([...PILLAR, '--score-only'], h.deps)
    expect(h.files.get('out/summary.md')).toContain('Diff shown to the pillar agent: only a.ts.')
  })

  it('leaves a normal run without the label, in the results and the summary', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli(PILLAR, h.deps)
    expect(h.prepared.map(([, paths]) => paths)).toEqual([undefined, undefined])
    expect(h.files.get('out/raw/correctness/p1.json')).not.toContain('onlyPath')
    expect(h.files.get('out/summary.md')).not.toContain('Diff shown')
    expect(h.files.get('out/summary.json')).not.toContain('onlyPath')
  })

  it('stops before any rules or model call when a later case has no matching file', async () => {
    const h = setup('p2')
    await expect(runReviewBenchCli([...PILLAR, '--only-path', 'a.ts'], h.deps)).rejects.toThrow(
      'case p2 changes none',
    )
    expect(h.prepared.map(([id]) => id)).toEqual(['p1'])
    expect(h.staged).toEqual([])
    expect(h.models).toEqual([])
  })

  it('stops before any work on an empty path or with --loads-only', async () => {
    const h = setup()
    await expect(runReviewBenchCli([...PILLAR, '--only-path', ''], h.deps)).rejects.toThrow(
      'bench --only-path needs',
    )
    await expect(
      runReviewBenchCli([...PILLAR, '--only-path', 'a.ts', '--loads-only'], h.deps),
    ).rejects.toThrow('bench --only-path cannot be used with --loads-only')
    expect(h.prepared).toEqual([])
  })
})
