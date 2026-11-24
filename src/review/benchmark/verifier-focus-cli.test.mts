import { afterEach, describe, expect, it, vi } from 'vitest'

import { runReviewVerifierBenchCli } from './verifier-cli.mts'
import type { VerifierBenchDeps } from './verifier-snapshot.mts'

const SHA = 'a'.repeat(40)
const FINDING = { pillar: 'design', severity: 'high', title: 'T', body: 'B' }
const CASE = {
  id: 'f1',
  repo: 'acme/widgets',
  pr: 1,
  title: 'f1',
  baseSha: SHA,
  headSha: SHA,
  kind: 'negative',
  reason: '',
  expected: [],
  verifierFocus: [{ point: 'is bounded', status: 'holds', basis: 'Yes.', path: 'a.ts', line: 1 }],
  expectedDisproved: [{ check: 0, finding: 0 }],
}
const PLUGINS = JSON.stringify([{ id: 'rules@m', version: '1.0.0', enabled: true }])

function run(returned: unknown[]) {
  const store = new Map<string, string>([
    ['cases.json', JSON.stringify([CASE])],
    ['refs/verifier.md', 'VERIFIER'],
    ['refs/pillars/_contract.md', 'CONTRACT'],
    ['refs/pillars/congruence.md', 'CONGRUENCE'],
    ['f/raw/design/f1.json', JSON.stringify({ findings: [FINDING] })],
  ])
  const prompts: string[] = []
  const deps: VerifierBenchDeps = {
    exec: async (_command, args) => {
      if (args[0] === 'plugin') return PLUGINS
      prompts.push(args[1] as string)
      const structured = { summary: 's', findings: [], disproved: returned }
      return JSON.stringify({ structured_output: structured })
    },
    readFile: (path) => store.get(path) as string,
    writeFile: (path, text) => void store.set(path, text),
    exists: (path) => store.has(path),
    log: () => undefined,
    prepare: async () => ({ dir: '/snap', diff: '', body: '' }),
    stageRules: async () => 'digest',
  }
  const args = ['--cases', 'cases.json', '--findings-from', 'f', '--out', 'o', '--prompts', 'refs']
  return { deps, store, args, prompts }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('bench-verifier on a case that shows focus answers', () => {
  it('records the returned links and scores whether they equal the expected pairs', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const links = [{ check: 0, finding: 0, reason: 'One worker drops the check.' }]
    const { deps, store, args, prompts } = run(links)
    expect(await runReviewVerifierBenchCli(args, deps)).toBe(0)
    const raw = JSON.parse(store.get('o/raw/f1.json') as string)
    expect(raw.error).toBeUndefined()
    expect(raw.disproved).toEqual(links)
    expect(prompts[0]).toContain('## Requested focus checks')
    const summary = JSON.parse(store.get('o/summary.json') as string)
    expect(summary.scores[0].disproved).toEqual({
      expected: [{ check: 0, finding: 0 }],
      returned: [{ check: 0, finding: 0 }],
      matched: true,
    })
  })

  it('fails the case when the verifier returns an extra pair', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const extra = [
      { check: 0, finding: 0, reason: 'r' },
      { check: 0, finding: 1, reason: 'r' },
    ]
    const { deps, store, args } = run(extra)
    await runReviewVerifierBenchCli(args, deps)
    const summary = JSON.parse(store.get('o/summary.json') as string)
    expect(summary.scores[0].disproved.matched).toBe(false)
  })
})
