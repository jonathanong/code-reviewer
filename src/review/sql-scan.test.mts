import { execFileSync, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  changedLines,
  filesWithChangedMatches,
  matchTouches,
  parseAstMatches,
  scanSqlPaths,
  type AstMatch,
} from './sql-scan.mts'

const range = (start: number, end: number) => ({ start: { line: start }, end: { line: end } })
const match = (file: string, start: number, end: number): AstMatch => ({
  file,
  range: range(start, end),
})

function diff(path: string, ...body: string[]): string {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`, ...body, ''].join(
    '\n',
  )
}

describe('changedLines', () => {
  it('numbers added lines in the head file and removed lines in the base file', () => {
    const lines = changedLines(
      diff(
        'a.ts',
        '@@ -10,4 +20,4 @@',
        ' keep',
        '-old',
        '+new',
        '+new2',
        ' keep',
        '@@ -50 +60 @@',
        '-x',
        '+y',
      ),
    )
    expect(lines).toEqual({ added: [21, 22, 60], removed: [11, 50] })
  })

  it('ignores the file header and a no-newline marker', () => {
    const lines = changedLines(
      diff('a.ts', '@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b'),
    )
    expect(lines).toEqual({ added: [1], removed: [1] })
  })
})

describe('matchTouches and filesWithChangedMatches', () => {
  it('counts a match whose lines (0-based) cover a changed line (1-based)', () => {
    expect(matchTouches(match('a.ts', 4, 9), new Set([5]))).toBe(true)
    expect(matchTouches(match('a.ts', 4, 9), new Set([10]))).toBe(true)
    expect(matchTouches(match('a.ts', 4, 9), new Set([4, 11]))).toBe(false)
  })

  it('reports only the query argument of a .query( call', () => {
    const call: AstMatch = {
      file: 'a.ts',
      range: range(0, 5),
      metaVariables: { single: { Q: { range: range(0, 0) } } },
    }
    expect(matchTouches(call, new Set([1]))).toBe(true)
    expect(matchTouches(call, new Set([4]))).toBe(false)
  })

  it('maps matches back to paths under the scanned root', () => {
    const changed = new Map([
      ['src/a.ts', new Set([3])],
      ['src/b.ts', new Set([100])],
    ])
    const matches = [match('/r/src/a.ts', 2, 2), match('/r/src/b.ts', 2, 2)]
    expect(filesWithChangedMatches(matches, '/r', changed)).toEqual(new Set(['src/a.ts']))
  })

  it('reads ast-grep output, and an empty list', () => {
    expect(parseAstMatches('[]')).toEqual([])
    expect(parseAstMatches(JSON.stringify([match('a', 1, 2)]))).toEqual([match('a', 1, 2)])
  })
})

describe('scanSqlPaths with ast-grep output faked', () => {
  let tree: string
  beforeEach(() => {
    tree = mkdtempSync(join(tmpdir(), 'sql-scan-'))
    mkdirSync(join(tree, 'src'))
    writeFileSync(join(tree, 'src/feed.mts'), 'x\n')
  })
  afterEach(() => rmSync(tree, { recursive: true, force: true }))

  const input = (patch: string) => ({
    patch,
    tree,
    base: 'b'.repeat(40),
    config: '/rules/sgconfig.yml',
    generatedPaths: [],
  })
  const added = diff('src/feed.mts', '@@ -1 +1 @@', '-x', '+y')

  it('finds a file whose added line a match covers, and passes the files and config to ast-grep', async () => {
    const astGrep = vi.fn(async () => JSON.stringify([match(join(tree, 'src/feed.mts'), 0, 0)]))
    const fileAt = vi.fn(async () => undefined)
    const result = await scanSqlPaths({ astGrep, fileAt }, input(added))
    expect(result).toEqual({ paths: ['src/feed.mts'] })
    expect(astGrep).toHaveBeenCalledWith([
      'scan',
      '--config',
      '/rules/sgconfig.yml',
      '--json=compact',
      join(tree, 'src/feed.mts'),
    ])
  })

  it('scans the base file for a removed line, and ignores a match elsewhere in the file', async () => {
    const astGrep = vi.fn(async (args: string[]) => {
      const file = args.at(-1) as string
      return JSON.stringify([match(file, 0, 0)])
    })
    const fileAt = vi.fn(async () => 'select\n')
    const removedOnly = diff('src/feed.mts', '@@ -1 +1,0 @@', '-sql`select`')
    expect(await scanSqlPaths({ astGrep, fileAt }, input(removedOnly))).toEqual({
      paths: ['src/feed.mts'],
    })
    expect(fileAt).toHaveBeenCalledWith(tree, 'b'.repeat(40), 'src/feed.mts')
    const far = vi.fn(async () => JSON.stringify([match(join(tree, 'src/feed.mts'), 40, 41)]))
    expect(await scanSqlPaths({ astGrep: far, fileAt }, input(added))).toEqual({ paths: [] })
  })

  it('reads the base file of a renamed file under its old path', async () => {
    const astGrep = vi.fn(async (args: string[]) =>
      JSON.stringify([match(args.at(-1) as string, 0, 0)]),
    )
    const fileAt = vi.fn(async () => 'select\n')
    const renamed = [
      'diff --git a/src/old.mts b/src/new.mts',
      'similarity index 80%',
      'rename from src/old.mts',
      'rename to src/new.mts',
      '--- a/src/old.mts',
      '+++ b/src/new.mts',
      '@@ -1 +1,0 @@',
      '-sql`select`',
      '',
    ].join('\n')
    expect(await scanSqlPaths({ astGrep, fileAt }, input(renamed))).toEqual({
      paths: ['src/new.mts'],
    })
    expect(fileAt).toHaveBeenCalledWith(tree, 'b'.repeat(40), 'src/old.mts')
  })

  it('skips docs, tests, generated files and other languages without running ast-grep', async () => {
    const astGrep = vi.fn(async () => '[]')
    const fileAt = vi.fn(async () => undefined)
    const patch = [
      diff('docs/q.md', '@@ -1 +1 @@', '-a', '+SELECT'),
      diff('src/a.test.mts', '@@ -1 +1 @@', '-a', '+b'),
      diff('src/gen/q.ts', '@@ -1 +1 @@', '-a', '+b'),
      diff('app/q.py', '@@ -1 +1 @@', '-a', '+b'),
    ].join('')
    const result = await scanSqlPaths(
      { astGrep, fileAt },
      { ...input(patch), generatedPaths: ['src/gen/**'] },
    )
    expect(result).toEqual({ paths: [] })
    expect(astGrep).not.toHaveBeenCalled()
  })

  it('says why it was skipped when ast-grep is missing, fails, or there is no checkout', async () => {
    const fileAt = vi.fn(async () => undefined)
    const missing = vi.fn(async () => {
      throw Object.assign(new Error('spawn ast-grep ENOENT'), { code: 'ENOENT' })
    })
    expect(await scanSqlPaths({ astGrep: missing, fileAt }, input(added))).toEqual({
      paths: [],
      skipped: 'ast-grep was not found',
    })
    const failing = vi.fn(async () => {
      throw new Error('bad rule\nmore')
    })
    expect(await scanSqlPaths({ astGrep: failing, fileAt }, input(added))).toEqual({
      paths: [],
      skipped: 'ast-grep failed: bad rule',
    })
    const garbage = vi.fn(async () => 'not json')
    expect((await scanSqlPaths({ astGrep: garbage, fileAt }, input(added))).skipped).toContain(
      'ast-grep failed',
    )
    const none = await scanSqlPaths(
      { astGrep: missing, fileAt },
      { ...input(added), tree: undefined },
    )
    expect(none).toEqual({ paths: [], skipped: 'there is no local checkout' })
  })
})

// The real binary, on a git repository with a base and a head commit.
const RULES = join(import.meta.dirname, '../../ast-rules/sql/sgconfig.yml')
const hasAstGrep = spawnSync('ast-grep', ['--version']).status === 0

// CI installs ast-grep; a missing binary there is a failure, never a silent skip.
if (process.env['CI'] !== undefined && process.env['CI'] !== '' && !hasAstGrep) {
  describe('scanSqlPaths with the real ast-grep', () => {
    it('has ast-grep on PATH in CI', () => {
      expect.fail('ast-grep is not installed; the CI workflow must install it')
    })
  })
}

describe.skipIf(!hasAstGrep)('scanSqlPaths with the real ast-grep', () => {
  let repo: string
  const git = (...args: string[]) =>
    execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
      encoding: 'utf8',
    })
  const write = (path: string, text: string) => {
    mkdirSync(dirname(join(repo, path)), { recursive: true })
    writeFileSync(join(repo, path), text)
  }
  const astGrep = async (args: string[]) => execFileSync('ast-grep', args, { encoding: 'utf8' })
  const fileAt = async (_tree: string, sha: string, path: string) => git('show', `${sha}:${path}`)

  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), 'sql-real-'))
    git('init', '-q')
  })
  afterEach(() => rmSync(repo, { recursive: true, force: true }))

  async function changed(base: Record<string, string>, head: Record<string, string>) {
    for (const [path, text] of Object.entries(base)) write(path, text)
    git('add', '-A')
    git('commit', '-q', '-m', 'base')
    const baseSha = git('rev-parse', 'HEAD').trim()
    for (const path of Object.keys(base)) if (!(path in head)) rmSync(join(repo, path))
    for (const [path, text] of Object.entries(head)) write(path, text)
    git('add', '-A')
    git('commit', '-q', '-m', 'head')
    const patch = git('diff', baseSha, 'HEAD')
    return scanSqlPaths(
      { astGrep, fileAt },
      { patch, tree: repo, base: baseSha, config: RULES, generatedPaths: [] },
    )
  }

  const longTemplate = (middle: string) =>
    [
      'export async function f(db: Db) {',
      '  const a = 1',
      '  const b = 2',
      '  const c = 3',
      '  const d = 4',
      '  const rows = await db.query(sql`',
      '    select id',
      '    from users',
      '    where a = 1',
      '    and b = 2',
      `    ${middle}`,
      '    and c = 3',
      '    and d = 4',
      '    and e = 5',
      '    and f = 6',
      '  `)',
      '  return rows',
      '}',
      '',
    ].join('\n')

  it('finds a change deep inside a long sql template whose opening is outside the hunk', async () => {
    const result = await changed(
      { 'src/q.mts': longTemplate('and m = 1') },
      { 'src/q.mts': longTemplate('and m = 2') },
    )
    expect(result).toEqual({ paths: ['src/q.mts'] })
  })

  it('finds a removed line of SQL, a generic tag, a statement literal and a builder call', async () => {
    const base = {
      'src/a.ts': 'const x = sql`select 1`\nconst y = 1\n',
      'src/b.ts': 'const x = sql<Row>`select 1`\n',
      'src/c.ts': 'const q = "SELECT a FROM t WHERE b = 1"\n',
      'src/d.ts': "const q = db.selectFrom('users')\n",
    }
    const result = await changed(base, {
      'src/a.ts': 'const y = 1\n',
      'src/b.ts': 'const x = sql<Row>`select 2`\n',
      'src/c.ts': 'const q = "SELECT a FROM t WHERE b = 2"\n',
      'src/d.ts': "const q = db.selectFrom('accounts')\n",
    })
    expect(result.paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'])
  })

  it('leaves SQL-looking prose, comments, test files and an unchanged template alone', async () => {
    const base = {
      'src/log.ts': "log.info('Select a file from disk')\n",
      'src/note.ts': '// select * from users\nconst a = 1\n',
      'src/a.test.ts': 'const x = 1\n',
      'src/q.ts': 'const q = sql`select 1`\nconst n = 1\n',
    }
    const result = await changed(base, {
      'src/log.ts': "log.info('Select a file from the disk')\n",
      'src/note.ts': '// select * from accounts\nconst a = 1\n',
      'src/a.test.ts': 'const x = sql`select 1`\n',
      'src/q.ts': 'const q = sql`select 1`\nconst n = 2\n',
    })
    expect(result).toEqual({ paths: [] })
  })

  it('finds removed SQL lines in a renamed file', async () => {
    const rest = Array.from({ length: 20 }, (_, i) => `const v${i} = ${i}\n`).join('')
    const result = await changed(
      { 'src/old.ts': `const x = sql\`select 1\`\n${rest}` },
      { 'src/new.ts': rest },
    )
    expect(result.paths).toEqual(['src/new.ts'])
  })

  it('does not match .query or .execute on a variable or a non-literal argument', async () => {
    const result = await changed(
      { 'src/a.ts': 'const r = map.query(key)\nconst n = 1\n' },
      { 'src/a.ts': 'const r = map.query(other)\nconst n = 1\n' },
    )
    expect(result).toEqual({ paths: [] })
  })

  it('counts a changed sql template that a .query(variable) call uses elsewhere in the file', async () => {
    const file = (where: string) =>
      `const q = sql\`select id from t where ${where}\`\nawait pool.query(q)\n`
    const result = await changed({ 'src/a.ts': file('a = 1') }, { 'src/a.ts': file('a = 2') })
    expect(result.paths).toEqual(['src/a.ts'])
  })
})
