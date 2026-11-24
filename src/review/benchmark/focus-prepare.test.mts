import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildFocusFacts } from '../run/focus-facts.mts'
import type { FixtureCase, RepoCase } from './cases.mts'
import { defaultExec } from './exec.mts'
import { prepareFocusCase } from './focus-prepare.mts'
import { stageCaseRules } from './rules.mts'
import { prepareSnapshot } from './snapshot.mts'

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'focus-prep-'))
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('prepareFocusCase', () => {
  it('builds a two-commit git tree and review run dir for a fixture so buildFocusFacts computes line counts', async () => {
    const fixtureDir = join(root, 'fixture')
    mkdirSync(join(fixtureDir, 'base', 'src'), { recursive: true })
    mkdirSync(join(fixtureDir, 'head', 'src'), { recursive: true })
    writeFileSync(join(fixtureDir, 'base', 'AGENTS.md'), '# Rules\n')
    writeFileSync(join(fixtureDir, 'base', 'src', 'a.mts'), 'export const a = 1\n')
    writeFileSync(join(fixtureDir, 'head', 'AGENTS.md'), '# Rules\n')
    writeFileSync(join(fixtureDir, 'head', 'src', 'a.mts'), 'export const a = 2\n')
    const big = Array.from({ length: 240 }, (_, i) => `export const v${i} = ${i}`).join('\n')
    writeFileSync(join(fixtureDir, 'head', 'src', 'big.mts'), `${big}\n`)
    writeFileSync(join(fixtureDir, 'pr.md'), '# feat: add big file\n\nAdds a 240-line module.\n')

    const item: FixtureCase = {
      id: 'fx',
      fixture: 'fixture',
      fixtureDir,
      title: 'feat: add big file',
      kind: 'negative',
      reason: 'test',
      expected: [],
    }
    const prepared = await prepareFocusCase(
      item,
      { cache: join(root, 'cache'), work: join(root, 'work'), noRules: false },
      { exec: defaultExec, prepare: prepareSnapshot, stageRules: stageCaseRules },
    )
    expect(prepared.hasRules).toBe(true)
    expect(existsSync(join(prepared.out, 'diff', 'INDEX.md'))).toBe(true)
    expect(existsSync(join(prepared.out, 'rules', 'INDEX.md'))).toBe(true)
    expect(readFileSync(join(prepared.out, 'context.md'), 'utf8')).toContain(
      'Adds a 240-line module.',
    )

    const facts = await buildFocusFacts({
      tree: prepared.tree,
      out: prepared.out,
      baseSha: prepared.baseSha,
      headSha: prepared.headSha,
      exec: defaultExec,
    })
    expect(facts.files?.listed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/big.mts', status: 'added', lines: 240 }),
        expect.objectContaining({ path: 'src/a.mts', status: 'modified', lines: 1 }),
      ]),
    )
  })

  it('uses snapshot.dir directly for a repo case and skips rule staging with noRules', async () => {
    const snapDir = join(root, 'repo-snap')
    mkdirSync(snapDir, { recursive: true })
    const item: RepoCase = {
      id: 'r1',
      repo: 'acme/widgets',
      pr: 3,
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      title: 'feat: repo case',
      kind: 'negative',
      reason: 'test',
      expected: [],
    }
    const stageRules = vi.fn(async () => 'digest')
    const prepared = await prepareFocusCase(
      item,
      { cache: join(root, 'cache'), work: join(root, 'work'), noRules: true },
      {
        exec: defaultExec,
        prepare: async () => ({ dir: snapDir, diff: '', body: 'Repo description' }),
        stageRules,
      },
    )
    expect(prepared).toMatchObject({
      tree: snapDir,
      baseSha: item.baseSha,
      headSha: item.headSha,
      hasRules: false,
    })
    expect(stageRules).not.toHaveBeenCalled()

    // When stageRules does not write a rules directory, hasRules remains false.
    const preparedNoDir = await prepareFocusCase(
      item,
      { cache: join(root, 'cache'), work: join(root, 'work'), noRules: false },
      {
        exec: defaultExec,
        prepare: async () => ({ dir: snapDir, diff: '', body: 'Repo description' }),
        stageRules,
      },
    )
    expect(stageRules).toHaveBeenCalledOnce()
    expect(preparedNoDir.hasRules).toBe(false)
  })

  it('fetches the pinned heads of a repo case into the cache so the checkout can read them', async () => {
    const snapDir = join(root, 'pinned-snap')
    mkdirSync(snapDir, { recursive: true })
    const item: RepoCase = {
      id: 'r2',
      repo: 'acme/widgets',
      pr: 3,
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      title: 'feat: repo case',
      kind: 'negative',
      reason: 'test',
      expected: [],
      focusRefs: { '7': 'c'.repeat(40), '9': 'd'.repeat(40) },
    }
    const exec = vi.fn(async () => '')
    await prepareFocusCase(
      item,
      { cache: join(root, 'cache'), work: join(root, 'work'), noRules: true },
      { exec, prepare: async () => ({ dir: snapDir, diff: '', body: '' }), stageRules: vi.fn() },
    )
    const [command, args] = exec.mock.calls[0] as unknown as [string, string[]]
    expect(command).toBe('git')
    expect(args).toContain(join(root, 'cache', 'acme__widgets.git'))
    expect(args.slice(-3)).toEqual(['origin', 'c'.repeat(40), 'd'.repeat(40)])
  })
})
