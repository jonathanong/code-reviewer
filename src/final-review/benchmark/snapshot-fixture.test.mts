import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { splitDiff } from '../diff-files.mts'
import { ExecError, defaultExec } from './exec.mts'
import { normalizeFixtureDiff } from './snapshot-fixture.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('normalizeFixtureDiff headers', () => {
  it('rewrites deletion, addition, and quoted headers', () => {
    const diff = [
      'diff --git a/base/x.sql b/base/x.sql',
      '--- a/base/x.sql',
      '+++ /dev/null',
      'diff --git "a/head/caf\\303\\251.sql" "b/head/caf\\303\\251.sql"',
      '--- /dev/null',
      '+++ "b/head/caf\\303\\251.sql"',
      'diff --git "a/base/g\\303\\266ne.sql" "b/base/g\\303\\266ne.sql"',
      '--- "a/base/g\\303\\266ne.sql"',
    ].join('\n')
    expect(normalizeFixtureDiff(diff)).toBe(
      [
        'diff --git a/x.sql b/x.sql',
        '--- a/x.sql',
        '+++ /dev/null',
        'diff --git "a/caf\\303\\251.sql" "b/caf\\303\\251.sql"',
        '--- /dev/null',
        '+++ "b/caf\\303\\251.sql"',
        'diff --git "a/g\\303\\266ne.sql" "b/g\\303\\266ne.sql"',
        '--- "a/g\\303\\266ne.sql"',
      ].join('\n'),
    )
  })

  it('leaves splitDiff the repo paths of real git output for add, delete, and non-ASCII files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'normalize-'))
    dirs.push(dir)
    for (const side of ['base', 'head']) mkdirSync(join(dir, side))
    writeFileSync(join(dir, 'base/del.txt'), 'old\n')
    writeFileSync(join(dir, 'base/göne.txt'), 'old\n')
    writeFileSync(join(dir, 'head/add.txt'), 'new\n')
    writeFileSync(join(dir, 'head/café.txt'), 'new\n')
    const args = ['diff', '--no-index', '--no-color', 'base', 'head']
    const raw = await defaultExec('git', args, { cwd: dir }).catch((error: unknown) => {
      if (!(error instanceof ExecError) || error.code !== 1) throw error
      return error.stdout
    })
    // Guards the premise: git really emits these shapes.
    expect(raw).toContain('diff --git a/base/del.txt b/base/del.txt')
    expect(raw).toContain('"b/head/caf\\303\\251.txt"')
    const diff = normalizeFixtureDiff(raw)
    expect(diff).not.toMatch(/(?:base|head)\//u)
    expect(splitDiff(diff).map((file) => file.path)).toEqual([
      'add.txt',
      'caf\\303\\251.txt',
      'del.txt',
      'g\\303\\266ne.txt',
    ])
  })
})
