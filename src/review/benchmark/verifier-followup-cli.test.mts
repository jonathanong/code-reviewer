import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runReviewVerifierBenchCli } from './verifier-cli.mts'
import type { VerifierBenchDeps } from './verifier-snapshot.mts'

const FIXTURE = mkdtempSync(join(tmpdir(), 'followup-fixture-'))
writeFileSync(join(FIXTURE, 'pr.md'), '# T\n')

const CASE = {
  id: 'f1',
  fixture: FIXTURE,
  title: 'T',
  kind: 'negative',
  reason: '',
  expected: [],
  followUp: {
    previous: { sha: 'a'.repeat(40), findings: [] },
    unresolved: [
      { threadId: 'T1', severity: 'high', pillar: 'correctness', title: 'T', expect: 'fixed' },
    ],
  },
}

function setup(cases: object[], structured: object) {
  const store = new Map<string, string>([
    ['cases.json', JSON.stringify(cases)],
    ['refs/verifier.md', 'VERIFIER'],
    ['refs/pillars/_contract.md', 'CONTRACT'],
    ['refs/pillars/congruence.md', 'CONGRUENCE'],
  ])
  const deps: VerifierBenchDeps = {
    exec: async (_command, args) =>
      args[0] === 'plugin' ? '[]' : JSON.stringify({ structured_output: structured }),
    readFile: (path) => store.get(path) as string,
    writeFile: (path, text) => void store.set(path, text),
    exists: (path) => store.has(path),
    log: () => undefined,
    prepare: async () => ({ dir: '/snap', diff: '', body: '' }),
    stageRules: async () => 'digest',
  }
  const args = ['--cases', 'cases.json', '--findings-from', 'f', '--out', 'o', '--prompts', 'refs']
  return { deps, store, args }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('bench-verifier on a follow-up case', () => {
  it('runs without pillar findings, grades fixedThreadIds and reports the earlier findings', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { deps, store, args } = setup([CASE], {
      summary: 's',
      findings: [],
      fixedThreadIds: ['T1'],
    })
    expect(await runReviewVerifierBenchCli(args, deps)).toBe(0)
    const raw = JSON.parse(store.get('o/raw/f1.json') as string)
    expect(raw.error).toBeUndefined()
    expect(raw.followUp.threads).toMatchObject([{ thread: 'T1', expect: 'fixed', passed: true }])
    expect(out.mock.calls.flat().join('')).toContain(
      'Earlier findings of follow-ups: 1 of 1 judged as expected',
    )
  })
})
