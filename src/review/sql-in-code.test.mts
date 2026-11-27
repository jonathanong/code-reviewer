import { describe, expect, it } from 'vitest'

import { isSqlLine, pathsChangingSql } from './sql-in-code.mts'

/** A one-file unified diff with `body` lines (each already carrying its marker). */
function patch(path: string, ...body: string[]): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -10,3 +10,3 @@',
    ...body,
    '',
  ].join('\n')
}

describe('isSqlLine', () => {
  it.each([
    'const rows = await sql`select 1`',
    'const rows = await db.sql<Row>`',
    '  .selectFrom("users")',
    "  WHERE bound_at > now() - interval '1 second'",
    '    JOIN accounts a ON a.id = u.account_id',
    '    ORDER BY created_at DESC',
    'await pool.query("select id, name from users where id = $1", [id])',
    "const q = 'insert into audit (id) values ($1)'",
    "const q = `update users set name = 'x'`",
  ])('is SQL: %s', (line) => {
    expect(isSqlLine(line)).toBe(true)
  })

  it.each([
    '// select the rows from the table where the user is active',
    ' * Updates the user set by the caller.',
    '# SELECT * FROM users',
    'log.info("select a file from disk")',
    'throw new Error("Could not update the user settings")',
    'const where = options.where',
    'const LIMIT = 5',
    "label: 'Select an option'",
    'return from(rows).pipe(select(isActive))',
  ])('is not SQL: %s', (line) => {
    expect(isSqlLine(line)).toBe(false)
  })
})

describe('pathsChangingSql', () => {
  it('finds a changed line in a tagged template, added or removed', () => {
    expect(pathsChangingSql(patch('src/a.mts', '+  const r = await sql`select 1`'))).toEqual([
      'src/a.mts',
    ])
    expect(pathsChangingSql(patch('src/a.mts', "-  AND x < now() - interval '2 seconds'"))).toEqual(
      ['src/a.mts'],
    )
  })

  it('finds a changed line inside a template whose opening is only context', () => {
    const body = ['   const rows = await sql`', '     select id', '+      , bound_at', '   `']
    expect(pathsChangingSql(patch('src/a.mts', ...body))).toEqual(['src/a.mts'])
  })

  it('ignores a template that closed before the changed line', () => {
    const body = ['   const a = sql`select 1`', '+  const b = compute(a)']
    expect(pathsChangingSql(patch('src/a.mts', ...body))).toEqual([])
  })

  it('ignores SQL only in context lines, comments, and prose', () => {
    expect(pathsChangingSql(patch('src/a.mts', '   const r = sql`select 1`', '+  ok()'))).toEqual(
      [],
    )
    expect(pathsChangingSql(patch('src/a.mts', '+  // SELECT * FROM users WHERE id = 1'))).toEqual(
      [],
    )
    expect(pathsChangingSql(patch('src/a.mts', '+  log("select a file from disk")'))).toEqual([])
  })

  it('ignores markdown, test files, and generated files', () => {
    const sql = '+SELECT * FROM users'
    expect(pathsChangingSql(patch('docs/q.md', sql))).toEqual([])
    expect(pathsChangingSql(patch('src/a.test.mts', '+  sql`select 1`'))).toEqual([])
    expect(pathsChangingSql(patch('backend/test-helpers/a.mts', '+  sql`select 1`'))).toEqual([])
    expect(pathsChangingSql(patch('crates/x/tests.rs', '+  DELETE FROM orders'))).toEqual([])
    expect(pathsChangingSql(patch('src/gen/q.ts', '+  sql`select 1`'), ['src/gen/**'])).toEqual([])
  })

  it('reports every file that changes SQL', () => {
    const both = `${patch('src/a.ts', '+  sql`select 1`')}${patch('src/b.ts', '+  nothing()')}${patch('src/c.py', '+    SELECT 1')}`
    expect(pathsChangingSql(both)).toEqual(['src/a.ts', 'src/c.py'])
  })
})
