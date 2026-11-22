import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { EvalCase, FixtureCase } from './cases.mts'
import { CONTEXT_DIR, defaultExec, prepareSnapshot, type Exec } from './snapshot.mts'

const DIFF = [
  'diff --git a/a.ts b/a.ts',
  '--- a/a.ts',
  '+++ b/a.ts',
  '@@ -1 +1 @@',
  '-one',
  '+two',
  'diff --git a/b.ts b/b.ts',
  '--- a/b.ts',
  '+++ b/b.ts',
  '@@ -1 +1 @@',
  '-three',
  '+four',
  '',
].join('\n')

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'snapshot-only-path-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

const repoCase: EvalCase = {
  id: 'repo-1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'T',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
}

const exec: Exec = async (command, args) => {
  if (command === 'git' && args.includes('diff')) return DIFF
  if (command === 'gh' && args[0] === 'pr')
    return JSON.stringify({ body: 'B', baseRefName: 'main' })
  return ''
}

function fixture(): FixtureCase {
  const dir = join(root, 'fx')
  for (const side of ['base', 'head']) mkdirSync(join(dir, side), { recursive: true })
  writeFileSync(join(dir, 'base/a.ts'), 'one\n')
  writeFileSync(join(dir, 'head/a.ts'), 'two\n')
  writeFileSync(join(dir, 'base/b.ts'), 'three\n')
  writeFileSync(join(dir, 'head/b.ts'), 'four\n')
  writeFileSync(join(dir, 'pr.md'), '# T\n\nBody')
  return {
    id: 'fx-1',
    fixture: 'fx',
    fixtureDir: dir,
    title: 'T',
    kind: 'negative',
    reason: '',
    expected: [],
  }
}

const read = (dir: string, name: string) => readFileSync(join(dir, CONTEXT_DIR, name), 'utf8')

describe('prepareSnapshot with onlyPath', () => {
  it('writes only the matching files of a repo case and returns the filtered diff', async () => {
    const snapshot = await prepareSnapshot(
      repoCase,
      join(root, 'cache'),
      join(root, 'work'),
      exec,
      ['b.ts'],
    )
    expect(snapshot.diff).toContain('diff --git a/b.ts b/b.ts')
    expect(snapshot.diff).not.toContain('a.ts')
    expect(read(snapshot.dir, 'diff.patch')).not.toContain('a.ts')
    expect(read(snapshot.dir, 'files.md')).toMatch(/Changed files \(1\)[\s\S]*b\.ts/u)
    expect(read(snapshot.dir, 'files.md')).not.toContain('a.ts')
  })

  it('writes only the matching files of a fixture case and keeps the whole head tree', async () => {
    const snapshot = await prepareSnapshot(
      fixture(),
      join(root, 'cache'),
      join(root, 'work'),
      defaultExec,
      ['./a.ts'],
    )
    expect(snapshot.diff).toContain('diff --git a/a.ts b/a.ts')
    expect(snapshot.diff).not.toContain('b.ts')
    expect(read(snapshot.dir, 'files.md')).toContain('(1)')
    expect(readFileSync(join(snapshot.dir, 'b.ts'), 'utf8')).toBe('four\n')
  })

  it('fails naming the case and the paths when a case changes none of them', async () => {
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    await expect(prepareSnapshot(repoCase, cache, work, exec, ['z.ts'])).rejects.toThrow(
      'case repo-1 changes none of z.ts',
    )
    await expect(prepareSnapshot(fixture(), cache, work, defaultExec, ['z.ts'])).rejects.toThrow(
      'case fx-1 changes none of z.ts',
    )
  })

  it('keeps the whole diff without paths', async () => {
    const snapshot = await prepareSnapshot(repoCase, join(root, 'cache'), join(root, 'work'), exec)
    expect(snapshot.diff).toBe(DIFF)
  })
})
