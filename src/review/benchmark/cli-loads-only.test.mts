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
    expectedSkills: ['skills:one'],
  },
]
const BASE = ['--cases', 'cases.json', '--out', 'out', '--prompts', 'prompts']

function harness() {
  const files = new Map([
    ['cases.json', JSON.stringify(CASES)],
    ['prompts/rules.md', 'R'],
    ['prompts/security.md', 'S'],
    ['/snap/p1/.review/pr.md', '# T'],
  ])
  const calls: string[][] = []
  const deps: PillarBenchDeps = {
    exec: async (_command, args) => {
      if (args[0] === 'plugin') return '[]'
      calls.push(args)
      return JSON.stringify({ structured_output: { findings: [] } })
    },
    readFile: (path) => files.get(path) as string,
    writeFile: (path, text) => void files.set(path, text),
    exists: (path) => files.has(path),
    log: () => {},
    prepare: async (item) => ({ dir: `/snap/${item.id}`, diff: '', body: '' }),
    cwd: () => '/work',
    selection: {
      skills: () => [{ name: 'skills:one', description: 'One.' }],
      select: async () => ({ selected: ['skills:one'], available: 1, usage: null }),
    },
    stageRules: async () => 'digest',
  }
  return { deps, files, calls }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runReviewBenchCli --loads-only', () => {
  it('runs a pillar the case does not expect, with no judge, and reports loads', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness()
    await runReviewBenchCli([...BASE, '--pillar', 'security', '--loads-only'], h.deps)
    expect(h.calls).toHaveLength(1)
    expect(h.files.has('out/raw/security/p1.json')).toBe(true)
    const saved = JSON.parse(h.files.get('out/summary.json') as string)[0]
    expect(saved).toMatchObject({ mode: 'loads-only', pillar: 'security', runs: 1 })
    expect(saved.expectations[0].missing).toEqual(['skills:one'])
    expect(String(stdout.mock.calls[0]?.[0])).toContain('Loads only')
  })

  it('works with --select', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness()
    await runReviewBenchCli([...BASE, '--pillar', 'security', '--loads-only', '--select'], h.deps)
    expect(h.calls).toHaveLength(1)
    expect(JSON.parse(h.files.get('out/raw/security/p1.json') as string).selected).toEqual([
      'skills:one',
    ])
  })

  it('leaves a run unchanged when the case expects the pillar, and runs nothing otherwise without the flag', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const plain = harness()
    await runReviewBenchCli([...BASE, '--pillar', 'rules'], plain.deps)
    const only = harness()
    await runReviewBenchCli([...BASE, '--pillar', 'rules', '--loads-only'], only.deps)
    expect(plain.calls).toHaveLength(1)
    expect(only.calls).toEqual(plain.calls)
    expect(only.files.get('out/raw/rules/p1.json')).toBe(plain.files.get('out/raw/rules/p1.json'))
    expect(JSON.parse(plain.files.get('out/summary.json') as string)[0].summary).toHaveProperty(
      'recall',
    )
    const none = harness()
    await runReviewBenchCli([...BASE, '--pillar', 'security'], none.deps)
    expect(none.calls).toHaveLength(0)
  })

  it('rejects options that need a judge, a control or a pillar choice', async () => {
    const { deps } = harness()
    await expect(runReviewBenchCli([...BASE, '--loads-only'], deps)).rejects.toThrow('--pillar')
    for (const extra of [['--judge', 'opus'], ['--baseline', 'x'], ['--no-rules']])
      await expect(
        runReviewBenchCli([...BASE, '--pillar', 'rules', '--loads-only', ...extra], deps),
      ).rejects.toThrow(extra[0] as string)
  })
})
