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

type Call = [string, string[]]

function fakeExec(calls: Call[]): Exec {
  return async (command, args) => {
    calls.push([command, args])
    if (command === 'git' && args.includes('diff')) return DIFF
    if (command === 'gh' && args[0] === 'pr') {
      return JSON.stringify({ body: '  PR body \n', baseRefName: 'trunk' })
    }
    if (command === 'gh' && args[0] === 'repo') return 'https://github.com/acme/widgets\n'
    return ''
  }
}

const DIFF = 'diff --git a/a.ts b/a.ts'

const isCacheCreate = ([command, args]: Call) => command === 'gh' && args[0] === 'repo'
/** The git subcommand, past `-C <dir>` and any `-c key=value` pairs. */
function gitVerb([command, args]: Call): string {
  if (command !== 'git') return command
  const rest = [...args]
  while (rest[0] === '-C' || rest[0] === '-c') rest.splice(0, 2)
  return rest[0] === 'remote' ? 'remote add' : (rest[0] as string)
}

describe('prepareSnapshot', () => {
  it('fetches the two commits into a bare cache, builds a checkout, and writes context files', async () => {
    const calls: Call[] = []
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    const snapshot = await prepareSnapshot(item, cache, work, fakeExec(calls))
    const repoDir = join(cache, 'acme__widgets.git')
    expect(snapshot).toEqual({
      dir: join(work, 'case-1', 'tree'),
      diff: DIFF,
      body: '  PR body \n',
    })
    expect(calls.map(gitVerb)).toEqual([
      'gh',
      'init',
      'remote add',
      'fetch',
      'gh',
      'init',
      'update-ref',
      'symbolic-ref',
      'checkout',
      'diff',
    ])
    expect(calls[0]?.[1]).toEqual(['repo', 'view', 'acme/widgets', '--json', 'url', '-q', '.url'])
    expect(calls[1]?.[1]).toEqual(['init', '--quiet', '--bare', repoDir])
    expect(calls[2]?.[1]).toEqual([
      '-C',
      repoDir,
      'remote',
      'add',
      'origin',
      'https://github.com/acme/widgets',
    ])
    const fetchArgs = calls[3]?.[1] as string[]
    expect(fetchArgs.slice(-3)).toEqual(['origin', item.baseSha, item.headSha])
    expect(fetchArgs).toContain('credential.helper=!gh auth git-credential')
    expect(fetchArgs).not.toContain('--depth')
    expect(fetchArgs.some((arg) => arg.startsWith('--filter'))).toBe(false)
    expect(calls[4]?.[1]).toContain('body,baseRefName')
    const tree = join(work, 'case-1', 'tree')
    expect(calls[6]?.[1]).toEqual([
      '-C',
      tree,
      'update-ref',
      'refs/remotes/origin/trunk',
      item.baseSha,
    ])
    expect(calls[7]?.[1]).toEqual([
      '-C',
      tree,
      'symbolic-ref',
      'refs/remotes/origin/HEAD',
      'refs/remotes/origin/trunk',
    ])
    expect(calls[8]?.[1]).toEqual(['-C', tree, 'checkout', '--quiet', '--detach', item.headSha])
    expect(calls[9]?.[1]).toEqual([
      '-C',
      repoDir,
      'diff',
      '--no-color',
      `${item.baseSha}...${item.headSha}`,
    ])
    expect(readFileSync(join(tree, '.git', 'objects', 'info', 'alternates'), 'utf8')).toBe(
      `${join(repoDir, 'objects')}\n`,
    )
    expect(readFileSync(join(tree, '.git', 'info', 'exclude'), 'utf8')).toBe('.review/\n')
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'diff.patch'), 'utf8')).toBe(DIFF)
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'diff', '0001.patch'), 'utf8')).toBe(
      `${DIFF}\n`,
    )
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'files.md'), 'utf8')).toContain(
      '.review/diff/0001.patch` +0 -0 a.ts',
    )
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'pr.md'), 'utf8')).toBe(
      '# My title\n\nPR body\n',
    )
  })

  it('writes the description a case records instead of the current one', async () => {
    const recorded = { ...item, body: 'As it read at this head.' }
    const snapshot = await prepareSnapshot(
      recorded,
      join(root, 'cache'),
      join(root, 'work'),
      fakeExec([]),
    )
    expect(snapshot.body).toBe('As it read at this head.')
    expect(readFileSync(join(snapshot.dir, CONTEXT_DIR, 'pr.md'), 'utf8')).toBe(
      '# My title\n\nAs it read at this head.\n',
    )
  })

  it('shares one cache between parallel cases of a repository', async () => {
    const calls: Call[] = []
    const other = { ...item, id: 'case-2' }
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    const exec = fakeExec(calls)
    await Promise.all([
      prepareSnapshot(item, cache, work, exec),
      prepareSnapshot(other, cache, work, exec),
    ])
    expect(calls.filter(isCacheCreate)).toHaveLength(1)
    expect(calls.filter((call) => gitVerb(call) === 'fetch')).toHaveLength(2)
  })

  it('removes a half-created cache and creates it again after a failure', async () => {
    const calls: Call[] = []
    const exec = fakeExec(calls)
    const failing: Exec = async (command, args, options) => {
      if (command === 'git' && args.includes('remote')) {
        mkdirSync(args[1] as string, { recursive: true })
        throw new Error('remote failed')
      }
      return exec(command, args, options)
    }
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    await expect(prepareSnapshot(item, cache, work, failing)).rejects.toThrow('remote failed')
    expect(existsSync(join(cache, 'acme__widgets.git'))).toBe(false)
    await expect(prepareSnapshot(item, cache, work, exec)).resolves.toBeDefined()
    expect(calls.filter(isCacheCreate)).toHaveLength(2)
  })

  it('does not leave the cache pending when `gh repo view` fails', async () => {
    const calls: Call[] = []
    const exec = fakeExec(calls)
    const failing: Exec = async (command, args, options) => {
      if (command === 'gh' && args[0] === 'repo') throw new Error('no such repo')
      return exec(command, args, options)
    }
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    await expect(prepareSnapshot(item, cache, work, failing)).rejects.toThrow('no such repo')
    await expect(prepareSnapshot(item, cache, work, exec)).resolves.toBeDefined()
  })

  it('reuses an existing cache and rebuilds a stale case tree', async () => {
    const cache = join(root, 'cache')
    const work = join(root, 'work')
    mkdirSync(join(cache, 'acme__widgets.git'), { recursive: true })
    writeFileSync(join(cache, 'acme__widgets.git', 'HEAD'), 'ref: refs/heads/main\n')
    mkdirSync(join(work, 'case-1', 'tree'), { recursive: true })
    writeFileSync(join(work, 'case-1', 'tree', 'stale.txt'), 'old')
    const calls: Call[] = []
    const snapshot = await prepareSnapshot(item, cache, work, fakeExec(calls))
    expect(calls.some(isCacheCreate)).toBe(false)
    expect(calls.filter((call) => gitVerb(call) === 'fetch')).toHaveLength(1)
    expect(() => readFileSync(join(snapshot.dir, 'stale.txt'))).toThrow()
  })

  it('rejects a pull request without a base branch', async () => {
    const exec = fakeExec([])
    const noBase: Exec = async (command, args, options) =>
      command === 'gh' && args[0] === 'pr'
        ? '{"body":"b","baseRefName":""}'
        : exec(command, args, options)
    await expect(
      prepareSnapshot(item, join(root, 'cache'), join(root, 'work'), noBase),
    ).rejects.toThrow('no body or base branch')
    const noBody: Exec = async (command, args, options) =>
      command === 'gh' && args[0] === 'pr' ? '{"baseRefName":"main"}' : exec(command, args, options)
    await expect(
      prepareSnapshot(item, join(root, 'cache'), join(root, 'work'), noBody),
    ).rejects.toThrow('no body or base branch')
  })

  it('uses the default exec and surfaces its failures when no binaries exist', async () => {
    const cache = join(root, 'cache')
    const empty = join(root, 'empty-bin')
    mkdirSync(empty)
    mkdirSync(join(cache, 'acme__widgets.git'), { recursive: true })
    writeFileSync(join(cache, 'acme__widgets.git', 'HEAD'), 'ref: refs/heads/main\n')
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
    await expect(defaultExec('review-missing-binary', [])).rejects.toThrow(
      'review-missing-binary exited with ENOENT',
    )
  })
})
