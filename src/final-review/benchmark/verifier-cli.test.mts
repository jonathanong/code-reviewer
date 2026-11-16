import { afterEach, describe, expect, it, vi } from 'vitest'

import { judgeInputs } from './judge-all.mts'
import { runFinalReviewVerifierBenchCli } from './verifier-cli.mts'
import { gradeInputs } from './verifier-grade.mts'
import type { VerifierBenchDeps } from './verifier-snapshot.mts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const caseJson = (id: string, kind: 'positive' | 'negative') => ({
  id,
  repo: 'acme/widgets',
  pr: 1,
  title: id,
  baseSha: SHA_A,
  headSha: SHA_B,
  kind,
  reason: '',
  expected:
    kind === 'positive'
      ? [{ pillar: 'design', severity: 'high', path: 'a.ts', lines: [1, 2], claim: 'c' }]
      : [],
})

const CASES = [caseJson('p1', 'positive'), caseJson('n1', 'negative'), caseJson('x1', 'negative')]
const FINDING = { pillar: 'design', severity: 'high', title: 'T', body: 'B' }

const PLUGINS = JSON.stringify([
  { id: 'rules@m', version: '1.0.0', enabled: true },
  { id: 'other@m', version: '1.0.0', enabled: true },
])

function harness(exec: VerifierBenchDeps['exec']) {
  const store = new Map<string, string>([
    ['cases.json', JSON.stringify(CASES)],
    ['refs/verifier.md', 'VERIFIER'],
    ['refs/pillars/_contract.md', 'CONTRACT'],
    ['refs/pillars/congruence.md', 'CONGRUENCE'],
    [
      'f/raw/design/p1.json',
      JSON.stringify({
        findings: [FINDING],
        judged: {
          model: 'sonnet',
          inputs: judgeInputs(CASES[0]?.expected as never, [FINDING] as never),
          assignment: [0],
        },
      }),
    ],
    ['f/raw/design/n1.json', JSON.stringify({ findings: [FINDING] })],
  ])
  const logs: string[] = []
  const staged: unknown[][] = []
  const deps: VerifierBenchDeps = {
    exec: async (command, args, options) =>
      args[0] === 'plugin' ? PLUGINS : exec(command, args, options),
    readFile: (path) => {
      const text = store.get(path)
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    writeFile: (path, text) => void store.set(path, text),
    exists: (path) => store.has(path),
    log: (line) => void logs.push(line),
    prepare: async (item) => ({ dir: `/snap/${item.id}`, diff: '', body: '' }),
    stageRules: async (item, snapshot) => {
      staged.push([item.id, snapshot.dir])
      return `digest-${item.id}`
    },
  }
  return { deps, store, logs, staged }
}

const BASE = ['--cases', 'cases.json', '--findings-from', 'f', '--out', 'o']

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runFinalReviewVerifierBenchCli', () => {
  it('validates arguments', async () => {
    const { deps } = harness(async () => '')
    await expect(runFinalReviewVerifierBenchCli(['--out', 'o'], deps)).rejects.toThrow(
      'bench-verifier needs --cases, --findings-from, and --out.',
    )
    await expect(runFinalReviewVerifierBenchCli(BASE, deps)).rejects.toThrow(
      'bench-verifier needs --prompts.',
    )
  })

  it('verifies saved findings per case, records failures, and scores', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const prompts: string[] = []
    const h = harness(async (_command, args, options) => {
      prompts.push(args[1] as string)
      if (options?.cwd === '/snap/n1') throw 'verifier crashed'
      return JSON.stringify({
        structured_output: { summary: 's', findings: [{ ...FINDING, sources: [0, 1] }] },
      })
    })
    const args = [...BASE, '--prompts', 'refs', '--jobs', '1', '--model', 'opus']
    await expect(runFinalReviewVerifierBenchCli(args, h.deps)).resolves.toBe(0)
    expect(prompts[0]?.startsWith('VERIFIER\n\nCONTRACT\n\nCONGRUENCE\n\n## Benchmark run')).toBe(
      true,
    )
    expect(h.logs).toContain('skip x1: no pillar findings')
    expect(h.logs).toContain('verify p1')
    expect(h.logs).toContain('judge design n1')
    const markdown = h.store.get('o/summary.md') as string
    expect(markdown).toContain(
      'Labels judged by sonnet; other blocking and high findings checked by opus.',
    )
    expect(markdown).toContain('| 1 | 100% | 100% → 100% | 100% | n/a (0) | 100% | 1.0 → 1.0 |')
    expect(markdown).toContain('- n1: verifier crashed')
    expect(out).toHaveBeenCalledWith(`${markdown.trimEnd()}\n`)
  })

  it('stages rules into each verifier snapshot', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness(async () =>
      JSON.stringify({ structured_output: { summary: 's', findings: [] } }),
    )
    const args = [...BASE, '--prompts', 'refs', '--case', 'p1']
    await runFinalReviewVerifierBenchCli(args, h.deps)
    expect(h.staged).toEqual([['p1', '/snap/p1']])
    const saved = JSON.parse(h.store.get('o/raw/p1.json') as string) as { inputs: string }
    expect(saved.inputs).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('stages nothing with --no-rules and keys the saved output on the rules digest', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exec = vi.fn(async (_command: string, _args: string[]) =>
      JSON.stringify({ structured_output: { summary: 's', findings: [] } }),
    )
    const h = harness(exec)
    const args = [...BASE, '--prompts', 'refs', '--case', 'p1']
    await runFinalReviewVerifierBenchCli([...args, '--no-rules'], h.deps)
    expect(h.staged).toEqual([])
    const control = (JSON.parse(h.store.get('o/raw/p1.json') as string) as { inputs: string })
      .inputs
    const runs = () => exec.mock.calls.filter(([, a]) => String(a[1]).includes('VERIFIER')).length
    expect(runs()).toBe(1)
    await runFinalReviewVerifierBenchCli([...args, '--no-rules'], h.deps)
    expect(runs()).toBe(1)
    // Staging rules changes the run's inputs, so the control output is not reused.
    await runFinalReviewVerifierBenchCli(args, h.deps)
    expect(runs()).toBe(2)
    expect(h.staged).toHaveLength(1)
    const staged = (JSON.parse(h.store.get('o/raw/p1.json') as string) as { inputs: string }).inputs
    expect(staged).not.toBe(control)
  })

  it('scores saved runs only with --score-only', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exec = vi.fn(async () => '')
    const h = harness(exec)
    const input = { findings: [FINDING], real: [], planted: [] }
    const output = { summary: '', findings: [], sources: [] }
    const n1 = CASES[1] as never
    const graded = {
      judge: 'haiku',
      checker: 'opus',
      inputs: gradeInputs(n1, output, ['haiku', 'opus']),
      added: [],
      checks: [],
    }
    h.store.set('o/raw/n1.json', JSON.stringify({ input, output, graded }))
    h.store.set('o/raw/x1.json', JSON.stringify({ input, output }))
    await runFinalReviewVerifierBenchCli([...BASE, '--score-only', '--judge', 'haiku'], h.deps)
    expect(exec).not.toHaveBeenCalled()
    const markdown = h.store.get('o/summary.md') as string
    expect(markdown).toContain('judged by haiku')
    expect(markdown).toContain('| 1 | n/a | n/a → n/a | n/a | n/a (0) | n/a | 1.0 → 0.0 |')
    expect(markdown).toContain('- x1: not graded')
  })

  it('reuses a saved verifier output only while its run inputs match', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exec = vi.fn(async () =>
      JSON.stringify({
        structured_output: { summary: 's', findings: [{ ...FINDING, sources: [0, 1] }] },
      }),
    )
    const h = harness(exec)
    const args = [...BASE, '--prompts', 'refs', '--case', 'p1']
    const callsAfter = async (extra: string[] = []) => {
      await runFinalReviewVerifierBenchCli([...args, ...extra], h.deps)
      return exec.mock.calls.length
    }
    expect(await callsAfter()).toBe(1)
    expect(await callsAfter()).toBe(1)
    expect(JSON.parse(h.store.get('o/raw/p1.json') as string).graded.added).toEqual([null])
    expect(await callsAfter(['--model', 'sonnet'])).toBe(2)
    expect(await callsAfter(['--model', 'sonnet', '--max-turns', '9'])).toBe(3)
    h.store.set('refs/verifier.md', 'EDITED')
    expect(await callsAfter(['--model', 'sonnet', '--max-turns', '9'])).toBe(4)
  })

  it('repeats a saved verifier output that has no run inputs', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exec = vi.fn(async () =>
      JSON.stringify({ structured_output: { summary: 's', findings: [] } }),
    )
    const h = harness(exec)
    const output = { summary: '', findings: [], sources: [] }
    h.store.set(
      'o/raw/p1.json',
      JSON.stringify({ input: { findings: [], real: [], planted: [] }, output }),
    )
    await runFinalReviewVerifierBenchCli([...BASE, '--prompts', 'refs', '--case', 'p1'], h.deps)
    expect(exec).toHaveBeenCalled()
  })

  it('runs without plugin settings when plugins cannot be listed', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exec = vi.fn(async () =>
      JSON.stringify({ structured_output: { summary: 's', findings: [] } }),
    )
    const h = harness(exec)
    const listing = h.deps.exec
    h.deps.exec = async (command, args, options) => {
      if (args[0] === 'plugin') throw new Error('no claude')
      return listing(command, args, options)
    }
    await runFinalReviewVerifierBenchCli([...BASE, '--prompts', 'refs', '--case', 'p1'], h.deps)
    expect(h.logs).toContain('plugins: no claude')
    const args = (exec.mock.calls[0] as unknown as [string, string[]])[1]
    expect(args).not.toContain('--settings')
  })

  it('records a case whose labeled pillar is not judged instead of verifying it', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const exec = vi.fn(async () => {
      throw new Error('judge down')
    })
    const h = harness(exec)
    h.store.set('f/raw/design/p1.json', JSON.stringify({ findings: [FINDING] }))
    await runFinalReviewVerifierBenchCli([...BASE, '--prompts', 'refs', '--case', 'p1'], h.deps)
    expect(exec).toHaveBeenCalledTimes(1)
    expect(h.store.get('o/summary.md')).toContain('- p1: design findings are not judged by sonnet.')
  })

  it('reports cases with no saved run', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness(async () => '')
    await runFinalReviewVerifierBenchCli([...BASE, '--score-only'], h.deps)
    const markdown = h.store.get('o/summary.md') as string
    for (const id of ['p1', 'n1', 'x1']) expect(markdown).toContain(`- ${id}: not run`)
  })

  it('records non-crashing errors from Error instances', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness(async () => {
      throw new Error('bad')
    })
    h.deps.exists = (path) => path !== 'f/raw/design/n1.json' && h.store.has(path)
    await runFinalReviewVerifierBenchCli([...BASE, '--prompts', 'refs', '--case', 'p1'], h.deps)
    expect(h.store.get('o/summary.md')).toContain('- p1: bad')
  })
})
