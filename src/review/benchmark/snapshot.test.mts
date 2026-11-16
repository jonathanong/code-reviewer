import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EvalCase } from './cases.mts'
import {
  CONTEXT_DIR,
  ExecError,
  defaultExec,
  hasContextNotes,
  hasRulesIndex,
  normalizeFixtureDiff,
  prepareSnapshot,
  type Exec,
} from './snapshot.mts'

const item: EvalCase = {
  id: 'case-1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'My title',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
}

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'snapshot-test-'))
})
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function fakeExec(calls: Array<[string, string[]]>): Exec {
  return async (command, args) => {
    calls.push([command, args])
    if (command === 'git' && args.includes('archive')) {
      writeFileSync(args[args.indexOf('-o') + 1] as string, 'tar')
      return ''
    }
    if (command === 'tar') {
      mkdirSync(join(args[args.indexOf('-C') + 1] as string, 'src'), { recursive: true })
      writeFileSync(join(args[args.indexOf('-C') + 1] as string, 'src', 'a.ts'), 'x')
      return ''
    }
    if (command === 'git' && args.includes('diff')) return DIFF
    if (command === 'gh' && args[0] === 'pr') return '  PR body \n'
    return ''
  }
}

const DIFF = 'diff --git a/a.ts b/a.ts'

describe('prepareSnapshot', () => {
  it('clones once, exports a git-free tree, and writes context files', async () => {
    const calls: Array<[string, string[]]> = []
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    const snapshot = await prepareSnapshot(item, cache, work, fakeExec(calls))
    const repoDir = join(cache, 'acme__widgets')
    expect(snapshot).toEqual({
      dir: join(work, 'case-1', 'tree'),
      diff: DIFF,
      body: '  PR body \n',
    })
    expect(calls.map(([command, args]) => [command, args[0]])).toEqual([
      ['gh', 'repo'],
      ['git', '-C'],
      ['git', '-C'],
      ['tar', '-xf'],
      ['git', '-C'],
      ['gh', 'pr'],
    ])
    expect(calls[0]?.[1].slice(0, 4)).toEqual(['repo', 'clone', 'acme/widgets', repoDir])
    expect(calls[1]?.[1]).toContain('fetch')
    expect(readFileSync(join(snapshot.dir, 'src', 'a.ts'), 'utf8')).toBe('x')
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'diff.patch'), 'utf8')).toBe(DIFF)
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'diff', '0001.patch'), 'utf8')).toBe(
      `${DIFF}\n`,
    )
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'files.md'), 'utf8')).toContain(
      '`.review/diff/0001.patch` +0 -0 a.ts',
    )
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'files.md'), 'utf8')).toContain(
      '.review/diff/0001.patch` +0 -0 a.ts',
    )
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'pr.md'), 'utf8')).toBe(
      '# My title\n\nPR body\n',
    )
    expect(calls.at(-2)?.[1]).toContain(`${item.baseSha}...${item.headSha}`)
  })

  it('shares one clone between parallel cases of a repository', async () => {
    const calls: Array<[string, string[]]> = []
    const other = { ...item, id: 'case-2' }
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    const exec = fakeExec(calls)
    await Promise.all([
      prepareSnapshot(item, cache, work, exec),
      prepareSnapshot(other, cache, work, exec),
    ])
    expect(calls.filter(([command, args]) => command === 'gh' && args[0] === 'repo')).toHaveLength(
      1,
    )
  })

  it('retries a clone after a failed one', async () => {
    const calls: Array<[string, string[]]> = []
    const exec = fakeExec(calls)
    const failing: Exec = async (command, args, options) => {
      if (command === 'gh' && args[0] === 'repo') throw new Error('clone failed')
      return exec(command, args, options)
    }
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    await expect(prepareSnapshot(item, cache, work, failing)).rejects.toThrow('clone failed')
    await expect(prepareSnapshot(item, cache, work, exec)).resolves.toBeDefined()
    expect(calls.filter(([command, args]) => command === 'gh' && args[0] === 'repo')).toHaveLength(
      1,
    )
  })

  it('reuses an existing clone and clears stale work directories', async () => {
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    mkdirSync(join(cache, 'acme__widgets', '.git'), { recursive: true })
    mkdirSync(join(work, 'case-1', 'tree'), { recursive: true })
    writeFileSync(join(work, 'case-1', 'tree', 'stale.txt'), 'old')
    const calls: Array<[string, string[]]> = []
    const snapshot = await prepareSnapshot(item, cache, work, fakeExec(calls))
    expect(calls.some(([command, args]) => command === 'gh' && args[0] === 'repo')).toBe(false)
    expect(() => readFileSync(join(snapshot.dir, 'stale.txt'))).toThrow()
  })

  it('uses the default exec and surfaces its failures when no binaries exist', async () => {
    const cache = join(root, 'cache')
    const empty = join(root, 'empty-bin')
    mkdirSync(empty)
    mkdirSync(join(cache, 'acme__widgets', '.git'), { recursive: true })
    vi.stubEnv('PATH', empty)
    try {
      await expect(prepareSnapshot(item, cache, join(root, 'work'))).rejects.toThrow()
    } finally {
      vi.unstubAllEnvs()
    }
  })
})

const FIXTURES = resolve(import.meta.dirname, '../../../benchmarks/review/fixtures')

function fixtureCase(name: string): EvalCase {
  return {
    id: name,
    fixture: `fixtures/${name}`,
    fixtureDir: join(FIXTURES, name),
    title: 'Fallback',
    kind: 'negative',
    reason: '',
    expected: [],
  }
}

describe('prepareSnapshot for fixtures', () => {
  it('copies head, diffs against base with plain paths, and carries context.md', async () => {
    const snapshot = await prepareSnapshot(
      fixtureCase('lock-scope-race-response'),
      join(root, 'cache'),
      join(root, 'work'),
    )
    expect(existsSync(join(snapshot.dir, 'replies.mts'))).toBe(true)
    expect(existsSync(join(snapshot.dir, '.git'))).toBe(false)
    expect(snapshot.diff).toContain('diff --git a/replies.mts b/replies.mts')
    expect(snapshot.diff).toContain('--- a/replies.mts\n+++ b/replies.mts')
    expect(snapshot.diff).not.toContain('base/')
    expect(snapshot.diff).not.toContain('head/')
    expect(snapshot.body).toContain('Archived comments are read-only')
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'pr.md'), 'utf8')).toMatch(
      /^# feat: reject replies to archived comments\n\nArchived/u,
    )
    expect(hasContextNotes(snapshot.dir)).toBe(true)
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'context.md'), 'utf8')).toContain(
      'Other reviewers and comments',
    )
  })

  it('omits context.md when the fixture has none', async () => {
    const snapshot = await prepareSnapshot(
      fixtureCase('lock-scope-written-row-only'),
      join(root, 'cache'),
      join(root, 'work'),
    )
    expect(hasContextNotes(snapshot.dir)).toBe(false)
    expect(hasRulesIndex(snapshot.dir)).toBe(false)
    mkdirSync(join(snapshot.dir, CONTEXT_DIR, 'rules'), { recursive: true })
    writeFileSync(join(snapshot.dir, CONTEXT_DIR, 'rules', 'INDEX.md'), '#')
    expect(hasRulesIndex(snapshot.dir)).toBe(true)
  })

  it('uses the case title when pr.md has no title line', async () => {
    const dir = join(root, 'fx')
    mkdirSync(join(dir, 'base'), { recursive: true })
    mkdirSync(join(dir, 'head'), { recursive: true })
    writeFileSync(join(dir, 'pr.md'), '')
    const item = { ...fixtureCase('x'), fixtureDir: dir } as EvalCase
    const snapshot = await prepareSnapshot(
      item,
      join(root, 'cache'),
      join(root, 'work'),
      async () => '',
    )
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'pr.md'), 'utf8')).toBe('# Fallback\n\n\n')
  })

  it('rethrows other git failures', async () => {
    const item = fixtureCase('lock-scope-written-row-only')
    const run = (error: unknown) =>
      prepareSnapshot(item, join(root, 'cache'), join(root, 'work'), async () => {
        throw error
      })
    await expect(run(new ExecError('boom', 128, '', null))).rejects.toThrow('boom')
    await expect(run(new Error('plain'))).rejects.toThrow('plain')
  })
})

describe('normalizeFixtureDiff', () => {
  it('rewrites headers for added, deleted, and changed files only', () => {
    const diff = [
      'diff --git a/base/x.sql b/head/x.sql',
      '--- a/base/x.sql',
      '+++ b/head/x.sql',
      '+ a/base/keep',
      '--- /dev/null',
      '+++ b/head/new.sql',
    ].join('\n')
    expect(normalizeFixtureDiff(diff)).toBe(
      [
        'diff --git a/x.sql b/x.sql',
        '--- a/x.sql',
        '+++ b/x.sql',
        '+ a/base/keep',
        '--- /dev/null',
        '+++ b/new.sql',
      ].join('\n'),
    )
  })
})

describe('defaultExec', () => {
  it('returns stdout and honors cwd', async () => {
    await expect(defaultExec(process.execPath, ['-p', '1+1'])).resolves.toBe('2\n')
    await expect(
      defaultExec(process.execPath, ['-p', 'process.cwd()'], { cwd: root }),
    ).resolves.toContain('snapshot-test-')
  })

  it('rejects on a non-zero exit', async () => {
    const script = "process.stdout.write('out'); process.stderr.write('err'); process.exit(3)"
    const failure = defaultExec(process.execPath, ['-e', script, 'SECRET-ARG'])
    await expect(failure).rejects.toThrow(`${process.execPath} exited with 3\nout\nerr`)
    await expect(failure).rejects.not.toThrow('SECRET-ARG')
    await expect(defaultExec(process.execPath, ['-e', 'process.exit(4)'])).rejects.toThrow(
      /exited with 4$/u,
    )
    await expect(defaultExec('final-review-missing-binary', [])).rejects.toThrow(
      'final-review-missing-binary exited with ENOENT',
    )
  })
})
