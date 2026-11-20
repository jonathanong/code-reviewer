import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runGit, type RunTextCommand } from '../gh-cli/index.mts'
import { inspectPush } from './push-inspect.mts'
import { MAX_MERGES } from './push-types.mts'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'push-'))
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
/** A merge that conflicts leaves git exiting 1; the caller resolves it. */
const merge = (branch: string) => git('merge', '--no-ff', '--no-edit', branch).catch(() => '')

const FILE = 'one\ntwo\nthree\nfour\nfive\n'

/** `main` with a shared file, and `pr` branched from it with one commit of its own. */
async function start() {
  await git('init', '-q', '-b', 'main')
  await commit('a.txt', FILE)
  await git('checkout', '-q', '-b', 'pr')
  await commit('feature.txt', 'feature\n')
}
async function advanceMain(name: string, text: string) {
  await git('checkout', '-q', 'main')
  await commit(name, text)
  await git('checkout', '-q', 'pr')
}
const shas = async (reviewed: string) => ({
  reviewedSha: reviewed,
  baseSha: await sha('main'),
  headSha: await sha('pr'),
})

describe('inspectPush with merges of the base', () => {
  it('is base-merges-only for a clean merge, with what came in and no resolution to read', async () => {
    await start()
    const reviewed = await sha('pr')
    await advanceMain('other.txt', 'from main\n')
    await merge('main')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push).toMatchObject({ kind: 'base-merges-only', mergesTotal: 1, problems: [] })
    expect(push.merges).toEqual([{ sha: await sha('pr'), resolution: '', truncated: false }])
    expect(push.incoming?.diff).toContain('+++ b/other.txt')
    expect(push.incoming?.diff).not.toContain('feature.txt')
  })

  it('writes a conflict resolution as what the author changed beyond the automatic merge', async () => {
    await start()
    await commit('a.txt', 'one\nPR\nthree\nfour\nfive\n')
    const reviewed = await sha('pr')
    await advanceMain('b.txt', 'unrelated\n')
    await git('checkout', '-q', 'main')
    await commit('a.txt', 'one\nMAIN\nthree\nfour\nfive\n')
    await git('checkout', '-q', 'pr')
    await merge('main')
    put('a.txt', 'one\nPR and MAIN\nthree\nfour\nfive\n')
    await git('add', 'a.txt')
    await git('commit', '-q', '--no-edit')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('base-merges-only')
    expect(push.merges).toHaveLength(1)
    const [resolved] = push.merges
    expect(resolved?.resolution).toContain('+PR and MAIN')
    expect(resolved?.resolution).toContain('<<<<<<<')
  })

  it('reads a merge that changes the code beyond a resolution as one the reviewer must read', async () => {
    await start()
    const reviewed = await sha('pr')
    await advanceMain('other.txt', 'from main\n')
    await git('merge', '--no-ff', '--no-commit', 'main')
    put('feature.txt', 'sneaked in\n')
    await git('add', 'feature.txt')
    await git('commit', '-q', '--no-edit')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('base-merges-only')
    expect(push.merges[0]?.resolution).toContain('+sneaked in')
  })

  it('is substantive with the merges still read when an ordinary commit comes with them', async () => {
    await start()
    const reviewed = await sha('pr')
    await advanceMain('other.txt', 'from main\n')
    await merge('main')
    await commit('more.txt', 'more\n')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push).toMatchObject({ kind: 'substantive', mergesTotal: 1 })
    expect(push.merges).toHaveLength(1)
    expect(push.incoming).toBeUndefined()
  })

  it('is substantive when the merge brings in a branch other than the base', async () => {
    await start()
    const reviewed = await sha('pr')
    await git('checkout', '-q', '-b', 'topic', 'main')
    await commit('topic.txt', 'topic\n')
    await git('checkout', '-q', 'pr')
    await merge('topic')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push).toMatchObject({ kind: 'substantive', mergesTotal: 1 })
    expect(push.reason).toContain('not only merges of the base')
  })

  it('is substantive for plain new commits and reads no merge', async () => {
    await start()
    const reviewed = await sha('pr')
    await commit('more.txt', 'more\n')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push).toMatchObject({ kind: 'substantive', merges: [], mergesTotal: 0, problems: [] })
  })

  it('stops at the cap, reports the total, and reviews the push in full', async () => {
    await start()
    const reviewed = await sha('pr')
    for (let at = 0; at <= MAX_MERGES; at += 1) {
      await advanceMain(`m${at}.txt`, `${at}\n`)
      await merge('main')
    }
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('substantive')
    expect(push.mergesTotal).toBe(MAX_MERGES + 1)
    expect(push.merges).toHaveLength(MAX_MERGES)
  })

  it('is substantive when a resolution is too large to list', async () => {
    await start()
    const lines = (word: string) =>
      Array.from({ length: 20_000 }, (_, at) => `${word} ${at}\n`).join('')
    await commit('big.txt', lines('pr'))
    const reviewed = await sha('pr')
    await git('checkout', '-q', 'main')
    await commit('big.txt', lines('main'))
    await git('checkout', '-q', 'pr')
    await merge('main')
    put('big.txt', lines('both'))
    await git('add', 'big.txt')
    await git('commit', '-q', '--no-edit')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('substantive')
    expect(push.merges[0]?.truncated).toBe(true)
    expect(push.reason).toContain('too large')
  })

  it('is substantive when what came in from the base is too large to list', async () => {
    await start()
    const reviewed = await sha('pr')
    await advanceMain('huge.txt', 'x'.repeat(5_100_000))
    await merge('main')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('substantive')
    expect(push.reason).toContain('could not be listed')
  })

  it('is substantive when the reviewed head shares no history with the base', async () => {
    await start()
    await git('checkout', '-q', '--orphan', 'island')
    await commit('island.txt', 'island\n')
    const reviewed = await sha('island')
    await git('merge', '--no-ff', '--no-edit', '--allow-unrelated-histories', 'main')
    const push = await inspectPush(runGit, dir, {
      reviewedSha: reviewed,
      baseSha: await sha('main'),
      headSha: await sha('island'),
    })
    expect(push.kind).toBe('substantive')
    expect(push.reason).toContain('could not be listed')
  })

  it('records a problem and stays substantive when remerge-diff fails', async () => {
    await start()
    const reviewed = await sha('pr')
    await advanceMain('other.txt', 'from main\n')
    await merge('main')
    const failing: RunTextCommand = async (args) =>
      args.includes('--remerge-diff')
        ? Promise.reject(new Error('unsupported\nmore'))
        : runGit(args)
    const push = await inspectPush(failing, dir, await shas(reviewed))
    expect(push).toMatchObject({ kind: 'substantive', mergesTotal: 1, merges: [] })
    expect(push.problems).toEqual(['remerge-diff failed: unsupported'])
  })

  it('records a problem and stays substantive when git is older than 2.36', async () => {
    await start()
    const reviewed = await sha('pr')
    await advanceMain('other.txt', 'from main\n')
    await merge('main')
    const old: RunTextCommand = async (args) =>
      args.includes('--version') ? 'git version 2.35.1\n' : runGit(args)
    const push = await inspectPush(old, dir, await shas(reviewed))
    expect(push).toMatchObject({ kind: 'substantive', mergesTotal: 1, merges: [] })
    expect(push.problems).toEqual(['git is older than 2.36 (no remerge-diff)'])
  })
})

describe('inspectPush with rewritten history', () => {
  async function rewritten() {
    await start()
    await commit('a.txt', 'one\ntwo\nTHREE\nfour\nfive\n')
    const reviewed = await sha('pr')
    await advanceMain('a2.txt', 'x\n')
    await git('checkout', '-q', 'main')
    await commit('a.txt', 'zero\none\ntwo\nthree\nfour\nfive\n')
    await git('checkout', '-q', 'pr')
    return reviewed
  }

  it('is rebase-same-change when the change is the same wherever its lines now sit', async () => {
    const reviewed = await rewritten()
    await git('rebase', 'main')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('rebase-same-change')
    expect(push.rangeDiff).toBeUndefined()
    expect(push.incoming?.diff).toContain('+zero')
    expect(push.merges).toEqual([])
  })

  it('writes the range-diff when the commits no longer pair up', async () => {
    const reviewed = await rewritten()
    await git('rebase', 'main')
    await git('reset', '-q', '--soft', 'main')
    await git('commit', '-q', '-m', 'squashed')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('rebase-same-change')
    expect(push.rangeDiff).toContain('squashed')
  })

  it('is substantive when the rebase changed the pull request', async () => {
    const reviewed = await rewritten()
    await git('rebase', 'main')
    await commit('feature.txt', 'feature\nand more\n', 'amend')
    await git('reset', '-q', '--soft', 'HEAD~1')
    await git('commit', '-q', '--amend', '--no-edit')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('substantive')
    expect(push.reason).toContain('own change differs')
  })

  it('is substantive when what came in from the base is too large to list', async () => {
    await start()
    const reviewed = await sha('pr')
    await advanceMain('huge.txt', 'x'.repeat(5_100_000))
    await git('rebase', 'main')
    const push = await inspectPush(runGit, dir, await shas(reviewed))
    expect(push.kind).toBe('substantive')
    expect(push.reason).toContain('could not be listed')
  })

  it('is substantive with a problem when the histories share no ancestor', async () => {
    await start()
    const reviewed = await sha('pr')
    await git('checkout', '-q', '--orphan', 'unrelated')
    await commit('z.txt', 'z\n')
    const push = await inspectPush(runGit, dir, {
      reviewedSha: reviewed,
      baseSha: await sha('main'),
      headSha: await sha('unrelated'),
    })
    expect(push.kind).toBe('substantive')
    expect(push.problems).toHaveLength(1)
  })
})

describe('inspectPush when git cannot answer', () => {
  it('records a problem when the reviewed head is not in the checkout', async () => {
    await start()
    const push = await inspectPush(runGit, dir, { ...(await shas('0'.repeat(40))) })
    expect(push).toMatchObject({ kind: 'substantive', merges: [] })
    expect(push.problems).toHaveLength(1)
  })

  it('reports a failure that is not an Error by its text', async () => {
    await start()
    const reviewed = await sha('pr')
    await commit('more.txt', 'more\n')
    const broken: RunTextCommand = async (args) =>
      args.includes('rev-list') ? Promise.reject('plain failure') : runGit(args)
    const push = await inspectPush(broken, dir, await shas(reviewed))
    expect(push.problems).toEqual(['Git could not classify the push: plain failure'])
  })

  it('records a problem when a git command fails midway', async () => {
    await start()
    const reviewed = await sha('pr')
    await commit('more.txt', 'more\n')
    const broken: RunTextCommand = async (args) =>
      args.includes('rev-list') ? Promise.reject(new Error('rev-list broke\nmore')) : runGit(args)
    const push = await inspectPush(broken, dir, await shas(reviewed))
    expect(push.kind).toBe('substantive')
    expect(push.problems).toEqual(['Git could not classify the push: rev-list broke'])
  })
})
