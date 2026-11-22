import { describe, expect, it } from 'vitest'

import { parseEvalCases } from './cases.mts'
import type { BenchDeps } from './cli.mts'
import { benchCases, scoreLoads } from './loads-only.mts'

const base = { repo: 'acme/widgets', pr: 1, baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40) }
const CASES = parseEvalCases(
  [
    {
      ...base,
      id: 'c1',
      title: 'c1',
      kind: 'positive',
      reason: '',
      expected: [{ pillar: 'rules', severity: 'high', path: 'a.ts', lines: null, claim: 'c' }],
      expectedSkills: ['p:one', ['p:two', 'p:three']],
    },
    { ...base, id: 'c2', title: 'c2', kind: 'negative', reason: '', expected: [] },
    { ...base, id: 'c3', title: 'c3', kind: 'negative', reason: '', expected: [] },
  ],
  '.',
)
const usage = (cost: number) => ({
  costUsd: cost,
  turns: 4,
  inputTokens: 10,
  outputTokens: 5,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  byModel: {},
})

function deps(files: Map<string, string>): BenchDeps {
  return {
    exec: async () => '',
    readFile: (path) => files.get(path) as string,
    writeFile: (path, text) => void files.set(path, text),
    exists: (path) => files.has(path),
    log: () => {},
    prepare: async () => ({ dir: '', diff: '', body: '' }),
  }
}

describe('benchCases', () => {
  it('keeps every case in loads-only mode and the pillar own cases otherwise', () => {
    expect(benchCases(CASES, 'security', true).map((item) => item.id)).toEqual(['c1', 'c2', 'c3'])
    expect(benchCases(CASES, 'security', undefined).map((item) => item.id)).toEqual(['c2', 'c3'])
  })
})

describe('scoreLoads', () => {
  const files = new Map<string, string>([
    [
      'out/raw/security/c1.json',
      JSON.stringify({ findings: [], skills: ['p:one', 'p:three'], usage: usage(1) }),
    ],
    ['out/raw/security/c2.json', JSON.stringify({ findings: [], skills: ['p:one', 'p:x'] })],
    ['out/raw/security/c3.json', JSON.stringify({ error: 'boom' })],
    ['out/raw/rules/c2.json', JSON.stringify({ findings: [] })],
    ['out/raw/design/c1.json', JSON.stringify({ findings: [], skills: [] })],
  ])

  it('reports loads, expectations and cost without recall columns', () => {
    const out = scoreLoads(CASES, ['security', 'design'], 'out', deps(files))
    const saved = JSON.parse(files.get('out/summary.json') as string)
    expect(saved[0]).toMatchObject({
      mode: 'loads-only',
      pillar: 'security',
      runs: 2,
      skillsPerRun: { total: 4, mean: 2 },
      loads: { 'p:one': 2, 'p:three': 1, 'p:x': 1 },
      expectations: [{ id: 'c1', missing: [] }],
      errors: ['c3: boom'],
    })
    expect(saved[1]).toMatchObject({ pillar: 'design', runs: 1, loads: {} })
    expect(saved[1].expectations[0].missing).toEqual(['p:one', ['p:two', 'p:three']])
    expect(saved[1].errors).toEqual(['c2: not run', 'c3: not run'])
    expect(saved[0]).not.toHaveProperty('recall')
    expect(out).toContain('| security | 2 | 2.0 | 3 | 1 of 1 |')
    expect(out).toContain('| design | 1 | 0.0 | 0 | 0 of 1 |')
    expect(out).toContain('| security | p:one | 2 of 2 |')
    expect(out).toContain('- security c1: loaded p:one, p:two | p:three')
    expect(out).toContain('- design c1: missing p:one, p:two | p:three')
    expect(out).toContain('- security c3: boom')
    expect(out).toContain('| security | 1 | $1.00 | $1.00 | 4.0 | 10 |')
    expect(out).not.toMatch(/Recall|Severity|False alarms/u)
    expect(files.get('out/summary.md')).toBe(`${out}\n`)
  })

  it('counts a result saved without skills as a run that loaded none', () => {
    const out = scoreLoads(CASES.slice(1, 2), ['rules'], 'out', deps(files))
    expect(out).toContain('| rules | 1 | 0.0 | 0 | 0 of 0 |')
  })

  it('shows n/a and omits the load tables when nothing ran', () => {
    const out = scoreLoads(CASES.slice(1), ['security'], 'empty', deps(new Map()))
    expect(out).toContain('| security | 0 | n/a | 0 | 0 of 0 |')
    expect(out).not.toContain('Loads per skill')
    expect(out).not.toContain('Expected skills:')
  })
})
