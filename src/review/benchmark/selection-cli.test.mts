import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { SkillChoice } from '../run/types.mts'
import { runFinalReviewSelectionBenchCli, type SelectionBenchDeps } from './selection-cli.mts'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const caseJson = (id: string, expectedSkills?: unknown) => ({
  id,
  repo: 'acme/widgets',
  pr: 1,
  title: id,
  baseSha: SHA_A,
  headSha: SHA_B,
  kind: 'negative',
  expected: [],
  ...(expectedSkills === undefined ? {} : { expectedSkills }),
})

const CASES = [
  caseJson('s1', ['skills:one']),
  caseJson('s2', [['skills:one', 'skills:two'], 'skills:three']),
  caseJson('plain'),
]

const PLUGINS = JSON.stringify([
  { id: 'skills@m', version: '1', enabled: true, scope: 'user', installPath: '/p/skills' },
  { id: 'other@m', version: '1', enabled: true, scope: 'user', installPath: '/p/other' },
])

const DIFF = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-x\n+y\n'
const BASE = ['--cases', 'cases.json', '--out', 'o']

const choice = (selected: string[], extra: Partial<SkillChoice> = {}): SkillChoice => ({
  selected,
  available: 3,
  usage: null,
  ...extra,
})

function harness(answer: (id: string, attempt: number) => SkillChoice) {
  const store = new Map<string, string>([
    ['cases.json', JSON.stringify(CASES)],
    ['more.json', JSON.stringify([caseJson('s3', ['skills:one'])])],
    ['dupes.json', JSON.stringify([caseJson('s1', ['skills:one'])])],
  ])
  const logs: string[] = []
  const prepared: unknown[][] = []
  const selected: unknown[] = []
  const seen = new Map<string, number>()
  const deps: SelectionBenchDeps = {
    exec: async (command, args) => {
      if (command === 'claude' && args[0] === 'plugin') return PLUGINS
      throw new Error(`unexpected ${command}`)
    },
    readFile: (path) => {
      const text = store.get(path)
      if (text === undefined) throw new Error(`ENOENT ${path}`)
      return text
    },
    writeFile: (path, text) => void store.set(path, text),
    exists: (path) => store.has(path),
    log: (line) => void logs.push(line),
    prepare: async (item, cache, work) => {
      prepared.push([item.id, cache, work])
      store.set(`/snap/${item.id}/.review/pr.md`, `# Title of ${item.id}\n\nbody`)
      return { dir: `/snap/${item.id}`, diff: DIFF, body: '' }
    },
    skills: (installs) =>
      installs.map((install) => ({ name: `${install.name}:one`, description: '' })),
    select: async (input) => {
      selected.push(input)
      const id = input.title.replace('Title of ', '')
      const attempt = (seen.get(id) ?? 0) + 1
      seen.set(id, attempt)
      return answer(id, attempt)
    },
  }
  return { deps, store, logs, prepared, selected }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('runFinalReviewSelectionBenchCli', () => {
  it('validates arguments', async () => {
    const { deps } = harness(() => choice([]))
    await expect(runFinalReviewSelectionBenchCli(['--out', 'o'], deps)).rejects.toThrow(
      'bench-selection needs --cases and --out.',
    )
    await expect(runFinalReviewSelectionBenchCli(['--cases', 'cases.json'], deps)).rejects.toThrow(
      'bench-selection needs --cases and --out.',
    )
    await expect(
      runFinalReviewSelectionBenchCli([...BASE, '--attempts', '0'], deps),
    ).rejects.toThrow('--attempts must be a positive integer.')
    await expect(runFinalReviewSelectionBenchCli([...BASE, '--jobs', 'x'], deps)).rejects.toThrow(
      '--jobs must be a positive integer.',
    )
    await expect(
      runFinalReviewSelectionBenchCli([...BASE, '--case', 'plain'], deps),
    ).rejects.toThrow('no cases with expectedSkills')
    await expect(
      runFinalReviewSelectionBenchCli(
        ['--cases', 'cases.json', '--cases', 'dupes.json', '--out', 'o'],
        deps,
      ),
    ).rejects.toThrow('unique')
  })

  it('selects per attempt for cases with expectedSkills and scores each', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness((id, attempt) =>
      id === 's1'
        ? choice(attempt === 1 ? ['skills:one'] : ['skills:two'])
        : choice(['skills:two', 'skills:three']),
    )
    const args = ['--cases', 'cases.json', '--cases', 'more.json', '--out', 'o', '--attempts', '2']
    await expect(runFinalReviewSelectionBenchCli([...args, '--jobs', '1'], h.deps)).resolves.toBe(0)
    expect(h.prepared.map(([id]) => id)).toEqual(['s1', 's2', 's3'])
    expect(h.prepared[0]).toEqual(['s1', 'o/cache', 'o/work'])
    expect(h.selected).toHaveLength(6)
    expect(h.selected[0]).toMatchObject({
      title: 'Title of s1',
      cwd: '/snap/s1',
      skills: [
        { name: 'skills:one', description: '' },
        { name: 'other:one', description: '' },
      ],
      settings: { enabledPlugins: { 'skills@m': true, 'other@m': false } },
    })
    expect((h.selected[0] as { index: string }).index).toContain('0001.patch` +1 -1 a.ts')
    expect(JSON.parse(h.store.get('o/raw/s1/2.json') as string)).toMatchObject({
      selected: ['skills:two'],
    })
    expect(h.store.has('o/raw/plain/1.json')).toBe(false)
    const markdown = h.store.get('o/summary.md') as string
    expect(markdown).toContain('| s1 | skills:one | 1 of 2 | skills:one x1 | 1.0 | 0 |')
    expect(markdown).toContain(
      '| s2 | skills:one \\| skills:two; skills:three | 2 of 2 |  | 2.0 | 0 |',
    )
    expect(markdown).toContain('| skills:one \\| skills:two | 2 of 2 | 100% |')
    const line = JSON.parse(String(out.mock.calls[0]?.[0])) as Record<string, unknown>
    expect(line).toMatchObject({
      summary: 'o/summary.md',
      cases: 3,
      attempts: 6,
      hits: 3,
      errors: 0,
      costUsd: null,
    })
    expect(JSON.parse(h.store.get('o/summary.json') as string)).toMatchObject({
      summary: { hits: 3 },
    })
  })

  it('records an errored selection and counts its usage without scoring it', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const usage = {
      costUsd: 0.25,
      turns: 1,
      durationMs: 1,
      inputTokens: 5,
      outputTokens: 1,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      byModel: {},
    }
    const h = harness(() => choice([], { error: 'No skills returned.', usage }))
    await runFinalReviewSelectionBenchCli([...BASE, '--case', 's1', '--attempts', '1'], h.deps)
    const summary = JSON.parse(h.store.get('o/summary.json') as string) as {
      summary: { attempts: number; errors: number }
      costUsd: number
    }
    expect(summary).toMatchObject({ summary: { attempts: 0, errors: 1 }, costUsd: 0.25 })
    expect(h.store.get('o/summary.md')).toContain('- s1 attempt 1: No skills returned.')
  })

  it('rescoring with --score-only makes no model calls and flags attempts never run', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness(() => choice([]))
    h.store.set('o/raw/s1/1.json', JSON.stringify(choice(['skills:one'])))
    await runFinalReviewSelectionBenchCli([...BASE, '--case', 's1', '--score-only'], h.deps)
    expect(h.prepared).toEqual([])
    expect(h.selected).toEqual([])
    const summary = JSON.parse(h.store.get('o/summary.json') as string) as {
      summary: { hits: number; notRun: number }
    }
    expect(summary.summary).toMatchObject({ hits: 1, notRun: 2 })
  })

  it('reuses the cache directory from --cache', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const h = harness(() => choice(['skills:one']))
    await runFinalReviewSelectionBenchCli(
      [...BASE, '--case', 's1', '--attempts', '1', '--cache', 'shared'],
      h.deps,
    )
    expect(h.prepared[0]).toEqual(['s1', 'shared', 'o/work'])
  })

  it('reads and writes the real filesystem by default', async () => {
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const dir = mkdtempSync(join(tmpdir(), 'bench-selection-'))
    try {
      const cases = join(dir, 'cases.json')
      writeFileSync(cases, JSON.stringify([caseJson('s1', ['skills:one'])]))
      const out = join(dir, 'nested', 'out')
      mkdirSync(join(out, 'raw', 's1'), { recursive: true })
      writeFileSync(join(out, 'raw', 's1', '1.json'), JSON.stringify(choice(['skills:one'])))
      await expect(
        runFinalReviewSelectionBenchCli([
          '--cases',
          cases,
          '--out',
          out,
          '--score-only',
          '--attempts',
          '1',
        ]),
      ).resolves.toBe(0)
      expect(readFileSync(join(out, 'summary.md'), 'utf8')).toContain('1 of 1 (100%)')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
