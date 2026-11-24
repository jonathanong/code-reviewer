import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runGit, type RunTextCommand } from '../gh-cli/index.mts'
import { diffHeadChanges } from './carry-git.mts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'carry-git-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const IDENTITY = [
  '-c',
  'user.name=t',
  '-c',
  'user.email=t@example.test',
  '-c',
  'commit.gpgsign=false',
]
const git = (...args: string[]) => runGit(['-C', dir, ...IDENTITY, ...args])
const sha = async (ref: string) => (await git('rev-parse', ref)).trim()
const put = (name: string, text: string) => writeFileSync(join(dir, name), text)

async function commit(name: string, text: string, message = name) {
  put(name, text)
  await git('add', name)
  await git('commit', '-q', '-m', message)
}

async function initPr() {
  await git('init', '-q', '-b', 'main')
  await commit('shared.txt', 'one\ntwo\nthree\nfour\nfive\n')
  await git('checkout', '-q', '-b', 'pr')
  await commit('shared.txt', 'one\ntwo\nTHREE\nfour\nfive\n', 'pr edit shared')
  await commit('feature.txt', 'feature\n', 'pr add feature')
  const fromSha = await sha('pr')
  await git('checkout', '-q', 'main')
  await commit('shared.txt', 'zero\none\ntwo\nthree\nfour\nfive\n', 'main prepend shared')
  await commit('other.txt', 'from main\n', 'main add other')
  await git('checkout', '-q', 'pr')
  return fromSha
}

describe('diffHeadChanges', () => {
  it('reports identical after merging the base branch with shifted hunks', async () => {
    const fromSha = await initPr()
    await git('merge', '--no-ff', '--no-edit', 'main')
    const result = await diffHeadChanges(runGit, dir, {
      baseSha: await sha('main'),
      fromSha,
      headSha: await sha('pr'),
    })
    expect(result).toEqual({ identical: true, files: [], patch: '' })
  })

  it('reports identical after rebasing onto the base branch with shifted hunks', async () => {
    const fromSha = await initPr()
    await git('rebase', 'main')
    const result = await diffHeadChanges(runGit, dir, {
      baseSha: await sha('main'),
      fromSha,
      headSha: await sha('pr'),
    })
    expect(result).toEqual({ identical: true, files: [], patch: '' })
  })

  it('reports the exact delta when a new commit changes a file after merging base', async () => {
    const fromSha = await initPr()
    await git('merge', '--no-ff', '--no-edit', 'main')
    await commit('feature.txt', 'feature\nnit fix\n', 'fix nit')
    const result = await diffHeadChanges(runGit, dir, {
      baseSha: await sha('main'),
      fromSha,
      headSha: await sha('pr'),
    })
    expect(result.identical).toBe(false)
    expect(result.files).toEqual([
      {
        path: 'feature.txt',
        added: 1,
        removed: 0,
        patch: expect.stringContaining('+nit fix'),
      },
    ])
  })

  it('reports removed -- lines and added ++ lines as deltas instead of mistaking them for headers', async () => {
    await git('init', '-q', '-b', 'main')
    await commit('query.sql', '-- header comment\nSELECT 1;\n')
    await commit('notes.txt', 'intro\n')
    await git('checkout', '-q', '-b', 'pr')
    await commit('query.sql', 'SELECT 1;\n', 'remove sql comment')
    const fromSha = await sha('pr')
    await commit('query.sql', '-- header comment\nSELECT 1;\n', 'keep sql comment')
    await commit('notes.txt', 'intro\n++ marker line\n', 'add plus-plus line')
    const result = await diffHeadChanges(runGit, dir, {
      baseSha: await sha('main'),
      fromSha,
      headSha: await sha('pr'),
    })
    expect(result.identical).toBe(false)
    expect(result.files).toEqual([
      {
        path: 'notes.txt',
        added: 1,
        removed: 0,
        patch: expect.stringContaining('+++ marker line'),
      },
      {
        path: 'query.sql',
        added: 1,
        removed: 0,
        patch: expect.stringContaining('+-- header comment'),
      },
    ])
  })

  it('fetches only missing commits from origin and succeeds when they resolve', async () => {
    const origin = join(dir, 'origin')
    const clone = join(dir, 'clone')
    await runGit(['init', '-q', '-b', 'main', origin])
    writeFileSync(join(origin, 'a.txt'), 'v1\n')
    await runGit(['-C', origin, ...IDENTITY, 'add', '.'])
    await runGit(['-C', origin, ...IDENTITY, 'commit', '-q', '-m', 'init'])
    await runGit(['clone', '-q', origin, clone])
    await runGit(['-C', clone, 'checkout', '-q', '-b', 'pr'])
    writeFileSync(join(clone, 'f.txt'), 'local\n')
    await runGit(['-C', clone, ...IDENTITY, 'add', '.'])
    await runGit(['-C', clone, ...IDENTITY, 'commit', '-q', '-m', 'local old'])
    const fromSha = (await runGit(['-C', clone, 'rev-parse', 'HEAD'])).trim()
    writeFileSync(join(origin, 'other.txt'), 'remote\n')
    await runGit(['-C', origin, ...IDENTITY, 'add', '.'])
    await runGit(['-C', origin, ...IDENTITY, 'commit', '-q', '-m', 'remote main'])
    const baseSha = (await runGit(['-C', origin, 'rev-parse', 'main'])).trim()
    const result = await diffHeadChanges(runGit, clone, {
      baseSha,
      fromSha,
      headSha: fromSha,
    })
    expect(result.identical).toBe(true)
  })

  it('preserves the fetch error as cause when a single missing commit cannot be fetched', async () => {
    const fromSha = await initPr()
    const missing = '0'.repeat(40)
    const caught = await diffHeadChanges(runGit, dir, {
      baseSha: await sha('main'),
      fromSha,
      headSha: missing,
    }).catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain(`Commit ${missing} is not available`)
    expect((caught as Error).cause).toBeInstanceOf(Error)
  })

  it('falls back to per-commit fetches when batch fetch fails and preserves the per-commit cause', async () => {
    const fromSha = await initPr()
    const baseSha = await sha('main')
    const missingA = '1'.repeat(40)
    const missingB = '2'.repeat(40)
    const batchErr = new Error('batch rejected')
    const singleErr = new Error('single missingA failed')
    const fakeGit: RunTextCommand = async (args) => {
      const fetchIndex = args.indexOf('fetch')
      if (fetchIndex !== -1) {
        const fetched = args.slice(fetchIndex + 3)
        if (fetched.length > 1) throw batchErr
        if (fetched[0] === missingA) throw singleErr
        return ''
      }
      return runGit(args)
    }
    const caught = await diffHeadChanges(fakeGit, dir, {
      baseSha,
      fromSha: missingA,
      headSha: missingB,
    }).catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain(`Commit ${missingA} is not available`)
    expect((caught as Error).cause).toBe(singleErr)

    // When fetch succeeds without producing the commit, the error still throws without a cause.
    const silentFetch: RunTextCommand = async (args) => (args.includes('fetch') ? '' : runGit(args))
    const noCause = await diffHeadChanges(silentFetch, dir, {
      baseSha,
      fromSha,
      headSha: missingB,
    }).catch((error: unknown) => error)
    expect(noCause).toBeInstanceOf(Error)
    expect((noCause as Error).message).toContain(`Commit ${missingB} is not available`)
    expect((noCause as Error).cause).toBeUndefined()
  })

  it('throws when a head shares no merge-base with the base branch', async () => {
    const fromSha = await initPr()
    await git('checkout', '-q', '--orphan', 'island')
    await commit('island.txt', 'alone\n')
    await expect(
      diffHeadChanges(runGit, dir, {
        baseSha: await sha('main'),
        fromSha,
        headSha: await sha('island'),
      }),
    ).rejects.toThrow('Could not find a merge-base')
  })
})
