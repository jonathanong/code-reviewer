import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { runReviewVerifierBenchCli } from './verifier-cli.mts'
import type { VerifierBenchDeps } from './verifier-snapshot.mts'

const SKILL = 'jong-skills:postgres-locking'
const SENTENCE = 'Append-only writes never lock: votes, events, history.'

const FIXTURE = mkdtempSync(join(tmpdir(), 'answers-fixture-'))
writeFileSync(join(FIXTURE, 'pr.md'), '# T\n')

const CASE = {
  id: 'a1',
  fixture: FIXTURE,
  title: 'T',
  kind: 'negative',
  reason: '',
  expected: [],
  answerable: [
    {
      note: {
        thread: 'T1',
        login: 'reviewer-one',
        url: 'https://example.test/c/1',
        where: 'src/a.ts:3',
        text: 'Add a lock.',
        replies: [],
      },
      expect: 'answer',
      skill: SKILL,
    },
  ],
}

function plugins(): string {
  const root = mkdtempSync(join(tmpdir(), 'answers-cli-'))
  mkdirSync(join(root, 'skills', 'postgres-locking'), { recursive: true })
  writeFileSync(
    join(root, 'skills', 'postgres-locking', 'SKILL.md'),
    `---\nname: postgres-locking\ndescription: d\n---\n\n# Locking\n\n- ${SENTENCE}\n`,
  )
  return JSON.stringify([
    { id: 'jong-skills@m', version: '1', enabled: true, scope: 'user', installPath: root },
  ])
}

const reply = (skills: string[]) =>
  [
    ...skills.flatMap((skill, at) => [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: `u${at}`, name: 'Skill', input: { skill } }] },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `u${at}` }] } },
    ]),
    {
      type: 'result',
      structured_output: {
        summary: 's',
        findings: [],
        answers: [{ thread: 'T1', body: 'No lock.', rule: { skill: SKILL, quote: SENTENCE } }],
      },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n')

function setup(skills: string[]) {
  const store = new Map<string, string>([
    ['cases.json', JSON.stringify([CASE])],
    ['refs/verifier.md', 'VERIFIER'],
    ['refs/pillars/_contract.md', 'CONTRACT'],
    ['refs/pillars/congruence.md', 'CONGRUENCE'],
  ])
  const listing = plugins()
  const deps: VerifierBenchDeps = {
    exec: async (_command, args) => (args[0] === 'plugin' ? listing : reply(skills)),
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

describe('bench-verifier on a case that lists notes', () => {
  it('runs the case without pillar findings, grades the answers and reports them', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { deps, store, args } = setup([SKILL])
    expect(await runReviewVerifierBenchCli(args, deps)).toBe(0)
    const raw = JSON.parse(store.get('o/raw/a1.json') as string)
    expect(raw.error).toBeUndefined()
    expect(raw.answers.threads).toMatchObject([{ thread: 'T1', cited: SKILL, passed: true }])
    expect(out.mock.calls.flat().join('')).toContain('1 of 1 handled as expected')
  })

  it('fails the thread when the verifier did not load the skill it cites', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const { deps, store, args } = setup([])
    await runReviewVerifierBenchCli(args, deps)
    const raw = JSON.parse(store.get('o/raw/a1.json') as string)
    expect(raw.answers.threads[0].passed).toBe(false)
    expect(out.mock.calls.flat().join('')).toContain('0 of 1 handled as expected')
  })
})
