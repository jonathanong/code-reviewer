import { afterEach, describe, expect, it, vi } from 'vitest'

import { runReviewBenchCli, type PillarBenchDeps } from './cli.mts'
import { ROUNDS_BLOCK } from './rounds.mts'

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
const found = (path: string, line: number, title = `T ${path}:${line}`) => ({
  severity: 'high',
  title,
  body: 'B',
  path,
  line,
})

/** `replies` is one entry per model call: findings to return, or an Error to throw. */
function setup(replies: Array<Array<Record<string, unknown>> | Error>) {
  const files = new Map([
    ['cases.json', JSON.stringify(CASES)],
    ['prompts/correctness.md', 'C'],
    ['/snap/p1/.review/pr.md', '# T'],
  ])
  const calls: string[] = []
  const deps: PillarBenchDeps = {
    exec: async (_command, args) => {
      if (args[0] === 'plugin') return '[]'
      calls.push(JSON.stringify(args))
      const reply = replies[calls.length - 1] ?? []
      if (reply instanceof Error) throw reply
      return JSON.stringify({
        structured_output: { findings: reply },
        total_cost_usd: 0.5,
        num_turns: 4,
      })
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
  const raw = () => JSON.parse(files.get('out/raw/correctness/p1.json') as string)
  return { deps, files, calls, raw }
}

afterEach(() => vi.restoreAllMocks())

describe('runReviewBenchCli --rounds', () => {
  it('runs a second round told the first findings, merges, and labels every output', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup([[found('a.ts', 1)], [found('a.ts', 1, 'dup'), found('b.ts', 2)], []])
    await runReviewBenchCli([...PILLAR, '--rounds', '3'], h.deps)
    expect(h.calls).toHaveLength(3)
    expect(h.calls[0]).not.toContain('Earlier rounds')
    expect(h.calls[1]).toContain(ROUNDS_BLOCK.split('\n')[0])
    expect(h.calls[1]).toContain('T a.ts:1')
    expect(h.calls[2]).toContain('T b.ts:2')
    const raw = h.raw()
    expect(raw.findings.map((f: { title: string }) => f.title)).toEqual(['T a.ts:1', 'T b.ts:2'])
    expect(raw).toMatchObject({ rounds: 3, roundsRun: 3, roundFindings: [1, 1, 0] })
    expect(raw.usage.costUsd).toBe(1.5)
    expect(raw.usage.turns).toBe(12)
    expect(JSON.parse(h.files.get('out/summary.json') as string)[0].summary.rounds).toBe(3)
    const note = 'Rounds: pillar agent run up to 3 times per case; not what a review does'
    expect(h.files.get('out/summary.md')).toContain(note)
    expect(String(stdout.mock.calls.at(-1)?.[0])).toContain(note)
  })

  it('stops when a round adds nothing, and when the first finds nothing', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup([[found('a.ts', 1)], [found('a.ts', 1)], [found('c.ts', 3)]])
    await runReviewBenchCli([...PILLAR, '--rounds', '3'], h.deps)
    expect(h.calls).toHaveLength(2)
    expect(h.raw()).toMatchObject({ roundsRun: 2, roundFindings: [1, 0] })
    const empty = setup([[]])
    await runReviewBenchCli([...PILLAR, '--rounds', '2'], empty.deps)
    expect(empty.calls).toHaveLength(1)
    expect(empty.raw().roundFindings).toEqual([0])
  })

  it('keeps earlier findings when a later round errors', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup([[found('a.ts', 1)], new Error('boom'), new Error('boom')])
    await runReviewBenchCli([...PILLAR, '--rounds', '2'], h.deps)
    const raw = h.raw()
    expect(raw.findings).toHaveLength(1)
    expect(raw).toMatchObject({ rounds: 2, roundsRun: 1, roundFindings: [1] })
    expect(raw.roundError).toContain('boom')
    expect(raw.error).toBeUndefined()
  })

  it('keeps a finding without a line, and records rounds on a failed case', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const noLine = { severity: 'high', title: 'N', body: 'B', path: 'a.ts' }
    const h = setup([[noLine], [noLine]])
    await runReviewBenchCli([...PILLAR, '--rounds', '2'], h.deps)
    expect(h.raw().findings).toHaveLength(2)
    const failed = setup([new Error('boom'), new Error('boom')])
    await runReviewBenchCli([...PILLAR, '--rounds', '2'], failed.deps)
    expect(failed.raw()).toMatchObject({ rounds: 2 })
    expect(failed.raw().error).toContain('boom')
  })

  it('reads the label from saved results under --score-only, and refuses mixed rounds', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup([[found('a.ts', 1)], []])
    await runReviewBenchCli([...PILLAR, '--rounds', '2'], h.deps)
    await runReviewBenchCli([...PILLAR, '--score-only'], h.deps)
    expect(h.files.get('out/summary.md')).toContain('Rounds: pillar agent run up to 2 times')
    const two = h.raw()
    h.files.set('cases.json', JSON.stringify([CASES[0], { ...CASES[0], id: 'p2' }]))
    h.files.set('out/raw/correctness/p2.json', JSON.stringify({ ...two, rounds: undefined }))
    await expect(runReviewBenchCli([...PILLAR, '--score-only'], h.deps)).rejects.toThrow(
      'different --rounds',
    )
  })

  it('leaves a normal run and --rounds 1 without any rounds output', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    for (const extra of [[], ['--rounds', '1']]) {
      const h = setup([[found('a.ts', 1)]])
      await runReviewBenchCli([...PILLAR, ...extra], h.deps)
      expect(h.calls).toHaveLength(1)
      expect(h.files.get('out/raw/correctness/p1.json')).not.toContain('round')
      expect(h.files.get('out/summary.md')).not.toContain('Rounds')
      expect(h.files.get('out/summary.json')).not.toContain('"rounds"')
    }
  })

  it('stops before any work on a bad value or --loads-only', async () => {
    const h = setup([])
    for (const bad of ['0', '4', '1.5', 'x', '']) {
      await expect(runReviewBenchCli([...PILLAR, '--rounds', bad], h.deps)).rejects.toThrow(
        'bench --rounds needs an integer',
      )
    }
    await expect(
      runReviewBenchCli([...PILLAR, '--rounds', '2', '--loads-only'], h.deps),
    ).rejects.toThrow('bench --rounds cannot be used with --loads-only')
    expect(h.calls).toEqual([])
  })
})
