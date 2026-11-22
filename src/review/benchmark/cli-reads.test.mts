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
    expectedReads: ['a.ts', 'lib/b.ts'],
  },
]
const ARGS = ['--cases', 'cases.json', '--out', 'out', '--prompts', 'prompts']
const PILLAR = [...ARGS, '--pillar', 'correctness']

const tool = (name: string, input: unknown, id: string) => ({
  type: 'assistant',
  message: { content: [{ type: 'tool_use', name, input, id }] },
})
const result = (id: string) => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', tool_use_id: id }] },
})

const STREAM = [
  tool('Read', { file_path: '/snap/p1/a.ts' }, 'r1'),
  result('r1'),
  tool('Grep', { pattern: 'retry', glob: '*.ts' }, 'g1'),
  result('g1'),
  { type: 'result', structured_output: { findings: [] } },
]
  .map((event) => JSON.stringify(event))
  .join('\n')

function setup() {
  const files = new Map([
    ['cases.json', JSON.stringify(CASES)],
    ['prompts/correctness.md', 'C'],
    ['/snap/p1/.review/pr.md', '# T'],
  ])
  const deps: PillarBenchDeps = {
    exec: async (_command, args) => (args[0] === 'plugin' ? '[]' : STREAM),
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
  return { deps, files }
}

afterEach(() => vi.restoreAllMocks())

describe('bench reads', () => {
  it('saves reads relative to the snapshot and counts the expected reads opened', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    await runReviewBenchCli(PILLAR, h.deps)
    const raw = JSON.parse(h.files.get('out/raw/correctness/p1.json') as string)
    expect(raw.reads).toEqual(['a.ts'])
    expect(raw.searches).toEqual(['retry glob *.ts'])
    const summary = JSON.parse(h.files.get('out/summary.json') as string)[0]
    expect(summary.readCases).toEqual([
      { id: 'p1', expectedReads: ['a.ts', 'lib/b.ts'], opened: 1, missing: ['lib/b.ts'] },
    ])
    expect(h.files.get('out/summary.md')).toContain(
      'Reads:\n\n- correctness p1: opened 1 of 2 expected reads; not opened: lib/b.ts',
    )
    expect(summary.summary.recall).toBe(0)
  })

  it('reports not available for a result with no recorded reads or from another harness', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    const saved = { findings: [], skills: [], usage: {}, skillTool: true }
    for (const extra of [{}, { harness: 'codex', reads: [] }]) {
      h.files.set('out/raw/correctness/p1.json', JSON.stringify({ ...saved, ...extra }))
      await runReviewBenchCli([...PILLAR, '--score-only'], h.deps)
      const summary = JSON.parse(h.files.get('out/summary.json') as string)[0]
      expect(summary.readCases[0]).toMatchObject({ opened: null, missing: [] })
      expect(h.files.get('out/summary.md')).toContain(
        '- correctness p1: opened n/a of 2 expected reads (no reads recorded)',
      )
    }
  })

  it('leaves a case without expectedReads out of the report', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = setup()
    h.files.set('cases.json', JSON.stringify([{ ...CASES[0], expectedReads: undefined }]))
    await runReviewBenchCli(PILLAR, h.deps)
    expect(h.files.get('out/summary.md')).not.toContain('Reads:')
  })
})
