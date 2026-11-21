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
    expected: [{ pillar: 'security', severity: 'high', path: 'a.ts', lines: null, claim: 'c' }],
  },
]
const BASE = ['--cases', 'cases.json', '--out', 'out', '--prompts', 'prompts', '--select']

function harness() {
  const files = new Map([
    ['cases.json', JSON.stringify(CASES)],
    ['prompts/security.md', 'P'],
    ['/snap/p1/.review/pr.md', '# T'],
  ])
  const prompts: string[] = []
  const deps: PillarBenchDeps = {
    exec: async (_command, args) => {
      if (args[0] === 'plugin') return '[]'
      prompts.push(args[1] as string)
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
  return { deps, files, prompts }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runReviewBenchCli --excerpts', () => {
  it.each(['alongside', 'replace'] as const)(
    'with %s writes the excerpts and records the arm and skill loads',
    async (arm) => {
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
      const h = harness()
      await runReviewBenchCli([...BASE, '--excerpts', arm], h.deps)
      expect(h.files.has('/snap/p1/.review/review-context.md')).toBe(true)
      expect(h.prompts[0]).toContain('`.review/review-context.md` is reference data')
      expect(h.prompts[0]?.includes('## Quoted rules replace loading')).toBe(arm === 'replace')
      expect(JSON.parse(h.files.get('out/raw/security/p1.json') as string).excerpts).toBe(arm)
      const saved = JSON.parse(h.files.get('out/summary.json') as string)[0]
      expect(saved.excerpts).toBe(arm)
      expect(saved.skillLoads).toEqual({ runs: 1, total: 0, mean: 0 })
      const markdown = h.files.get('out/summary.md') as string
      expect(markdown).toContain(`Excerpts: ${arm}.`)
      expect(markdown).toContain(`| security | ${arm} | 1 | 0 | 0.0 |`)
    },
  )

  it('records no arm and adds no prompt text without the flag', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness()
    await runReviewBenchCli(BASE, h.deps)
    expect(h.prompts[0]).not.toContain('review-context.md')
    expect(h.files.has('/snap/p1/.review/review-context.md')).toBe(false)
    expect(JSON.parse(h.files.get('out/summary.json') as string)[0]).not.toHaveProperty('excerpts')
    expect(h.files.get('out/summary.md')).not.toContain('Excerpts')
  })

  it('rejects the flag without --select, with --no-rules, or with another value', async () => {
    const { deps } = harness()
    const rest = BASE.slice(0, -1)
    await expect(runReviewBenchCli([...rest, '--excerpts', 'replace'], deps)).rejects.toThrow(
      '--excerpts needs --select',
    )
    await expect(
      runReviewBenchCli([...BASE, '--no-rules', '--excerpts', 'replace'], deps),
    ).rejects.toThrow('--no-rules')
    await expect(runReviewBenchCli([...BASE, '--excerpts', 'x'], deps)).rejects.toThrow(
      'alongside or replace',
    )
  })
})
