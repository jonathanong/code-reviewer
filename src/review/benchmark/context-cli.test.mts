import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  defaultContextDeps,
  runReviewContextBenchCli,
  type ContextBenchDeps,
} from './context-cli.mts'
import { defaultExec } from './exec.mts'

const PLUGIN = fileURLToPath(new URL('../context/fixtures/plugin', import.meta.url))
const PLUGINS = JSON.stringify([
  { id: 'jong-skills@m', version: '1', enabled: true, scope: 'user', installPath: PLUGIN },
])
const SHA = 'a'.repeat(40)

const caseJson = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  repo: 'acme/widgets',
  pr: 1,
  title: id,
  baseSha: SHA,
  headSha: SHA,
  kind: 'negative',
  expected: [],
  ...extra,
})

const HISTORY = [
  {
    id: 'h1',
    title: 'T',
    base: [{ message: 'Add a', files: { 'a.txt': 'one\ntwo\n' } }],
    head: [{ message: 'Change a', files: { 'a.txt': 'one\nTWO\n' } }],
    expect: { history: [{ commit: 0, path: 'a.txt' }], linked: [] },
  },
]

const FILES: Record<string, unknown> = {
  'cases.json': [
    caseJson('c1', {
      expectedSkills: ['jong-skills:sample-rules'],
      expectedRules: [
        { skill: 'jong-skills:sample-rules', text: 'MUST NOT leave a gadget unplugged.' },
      ],
    }),
    caseJson('c2', { expectedSkills: [['jong-skills:sample-prose', 'jong-skills:sample-rules']] }),
    caseJson('plain'),
  ],
  'history.json': HISTORY,
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

function harness() {
  const written = new Map<string, string>()
  const exec = vi.fn<ContextBenchDeps['exec']>(async (command, args, options) =>
    command === 'claude' ? PLUGINS : defaultExec(command, args, options),
  )
  const deps: ContextBenchDeps = {
    exec,
    readFile: (path) => (path in FILES ? JSON.stringify(FILES[path]) : readFileSync(path, 'utf8')),
    writeFile: (path, text) => void written.set(path, text),
    log: () => undefined,
    tempDir: () => {
      const dir = mkdtempSync(join(tmpdir(), 'context-cli-'))
      dirs.push(dir)
      return dir
    },
    removeDir: (path) => rmSync(path, { recursive: true, force: true }),
  }
  return { deps, exec, written }
}

const quiet = () => vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

describe('runReviewContextBenchCli', () => {
  it('checks the rules of cases with expectedSkills and the history cases, and exits 0', async () => {
    const out = quiet()
    const { deps, exec, written } = harness()
    const code = await runReviewContextBenchCli(
      ['--cases', 'cases.json', '--history', 'history.json', '--out', 'o'],
      deps,
    )
    expect(code).toBe(0)
    expect(exec).toHaveBeenCalledWith('claude', ['plugin', 'list', '--json'])
    const json = JSON.parse(written.get(join('o', 'summary.json')) as string)
    expect(json.rules.map((item: { id: string }) => item.id)).toEqual(['c1', 'c2'])
    expect(json.summary.rules.expectedRules.present).toBe(1)
    expect(json.summary.history).toEqual({ cases: 1, checks: 1, found: 1 })
    expect(written.get(join('o', 'summary.md'))).toContain('| c1 | jong-skills:sample-rules full')
    expect(out).toHaveBeenCalledWith(expect.stringContaining('# Context bench'))
  })

  it('runs history cases alone without listing plugins, and filters by --case', async () => {
    quiet()
    const { deps, exec, written } = harness()
    await runReviewContextBenchCli(
      ['--history', 'history.json', '--out', 'o', '--case', 'nope'],
      deps,
    )
    expect(exec).not.toHaveBeenCalled()
    expect(JSON.parse(written.get(join('o', 'summary.json')) as string).history).toEqual([])
  })

  it('fails on usage errors', async () => {
    const { deps } = harness()
    await expect(runReviewContextBenchCli(['--out', 'o'], deps)).rejects.toThrow('needs --out')
    await expect(runReviewContextBenchCli(['--cases', 'cases.json'], deps)).rejects.toThrow(
      'needs --out',
    )
  })

  it('defaults read, write, make and remove a directory on the real file system', () => {
    const dir = defaultContextDeps.tempDir()
    dirs.push(dir)
    defaultContextDeps.writeFile(join(dir, 'x', 'f.json'), '{}')
    expect(defaultContextDeps.readFile(join(dir, 'x', 'f.json'))).toBe('{}')
    defaultContextDeps.log('')
    defaultContextDeps.removeDir(dir)
    expect(() => readFileSync(join(dir, 'x', 'f.json'))).toThrow()
  })
})
