import { afterEach, describe, expect, it, vi } from 'vitest'

import { runReviewBenchCli, type PillarBenchDeps } from './cli.mts'

const expected = (pillar: string) => [
  { pillar, severity: 'high', path: 'a.ts', lines: null, claim: 'c' },
]
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
    expected: [...expected('rules'), ...expected('security')],
  },
]
const BASE = ['--cases', 'cases.json', '--out', 'out', '--prompts', 'prompts', '--select']
const FORCED = 'call the Skill tool once for each of these skills'

function harness() {
  const files = new Map([
    ['cases.json', JSON.stringify(CASES)],
    ['prompts/rules.md', 'RULES'],
    ['prompts/security.md', 'SECURITY'],
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
  return { deps, prompts }
}
const forcedIn = (prompts: string[], marker: string) =>
  prompts.find((prompt) => prompt.includes(marker))?.includes(FORCED)

afterEach(() => {
  vi.restoreAllMocks()
})

describe('bench --select', () => {
  it('forces the selected skills on the rules pillar only, as review does', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const { deps, prompts } = harness()
    await runReviewBenchCli(BASE, deps)
    expect(forcedIn(prompts, 'RULES')).toBe(true)
    expect(forcedIn(prompts, 'SECURITY')).toBe(false)
  })

  it('forces them on every pillar with --select-all-pillars', async () => {
    vi.spyOn(process.stdout, 'write').mockReturnValue(true)
    const { deps, prompts } = harness()
    await runReviewBenchCli([...BASE, '--select-all-pillars'], deps)
    expect(forcedIn(prompts, 'RULES')).toBe(true)
    expect(forcedIn(prompts, 'SECURITY')).toBe(true)
  })

  it('needs --select for --select-all-pillars', async () => {
    const { deps } = harness()
    await expect(
      runReviewBenchCli(['--cases', 'cases.json', '--out', 'out', '--select-all-pillars'], deps),
    ).rejects.toThrow('bench --select-all-pillars needs --select.')
  })
})
