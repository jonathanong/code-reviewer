import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { runGit } from '../gh-cli/index.mts'
import { inspectCarried, type CarriedArgs } from './carried-inspect.mts'

let root: string
let dir: string
let origin: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'carried-'))
  dir = join(root, 'work')
  origin = join(root, 'origin.git')
  mkdirSync(dir)
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

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
async function commit(name: string, text: string, message = name) {
  writeFileSync(join(dir, name), text)
  await git('add', name)
  await git('commit', '-q', '-m', message)
}
const BASE_TEXT = 'one\ntwo\nthree\n'

/** `main` with one commit, cloned to a bare `origin` whose HEAD is `main`. */
async function start() {
  await git('init', '-q', '-b', 'main')
  await commit('base.txt', BASE_TEXT)
  await runGit(['clone', '-q', '--bare', dir, origin])
  await git('remote', 'add', 'origin', origin)
  await git('fetch', '-q', 'origin')
  await git('remote', 'set-head', 'origin', 'main')
}
const push = (branch: string) => git('push', '-q', 'origin', branch)

async function args(over: Partial<CarriedArgs> = {}): Promise<CarriedArgs> {
  return {
    baseSha: await sha('main'),
    headSha: await sha('HEAD'),
    baseRef: 'main',
    parents: [],
    others: [],
    ...over,
  }
}
const inspect = async (over: Partial<CarriedArgs> = {}) =>
  inspectCarried(runGit, dir, await args(over))

describe('inspectCarried', () => {
  it('finds nothing carried in an ordinary pull request', async () => {
    await start()
    await git('checkout', '-q', '-b', 'pr')
    await commit('feature.txt', 'feature\n')
    expect(await inspect()).toEqual({
      commits: [],
      commitsInRange: 1,
      files: [],
      filesTotal: 0,
      defaultBranch: 'main',
      base: 'default',
      problems: [],
    })
  })

  it('finds a commit the default branch already has as the same patch, and the file only it touches', async () => {
    await start()
    await git('checkout', '-q', '-b', 'pr')
    await commit('landed.txt', 'landed\n', 'landed elsewhere')
    const picked = await sha('pr')
    await commit('own.txt', 'own\n')
    await git('checkout', '-q', 'main')
    await commit('other.txt', 'other\n')
    const forkBase = await sha('main~1')
    await git('cherry-pick', picked)
    await push('main')
    await git('checkout', '-q', 'pr')
    const found = await inspect({ baseSha: forkBase })
    expect(found.commits).toEqual([
      { sha: picked, subject: 'landed elsewhere', home: { kind: 'default' }, how: 'patch' },
    ])
    expect(found.commitsInRange).toBe(2)
    expect(found.files).toEqual(['landed.txt'])
  })

  it('does not call a file carried when an own commit touches it too', async () => {
    await start()
    await git('checkout', '-q', '-b', 'pr')
    await commit('shared.txt', 'a\n', 'landed elsewhere')
    const picked = await sha('pr')
    await commit('shared.txt', 'a\nb\n', 'own change')
    await git('checkout', '-q', 'main')
    await commit('other.txt', 'other\n')
    const forkBase = await sha('main~1')
    await git('cherry-pick', picked)
    await push('main')
    await git('checkout', '-q', 'pr')
    const found = await inspect({ baseSha: forkBase })
    expect(found.commits.map((entry) => entry.sha).length).toBe(1)
    expect(found.files).toEqual([])
  })

  it('finds commits that are ancestors of the default branch behind a stale base', async () => {
    await start()
    await git('checkout', '-q', '-b', 'parent')
    await commit('parent.txt', 'parent\n')
    await push('parent')
    await git('checkout', '-q', '-b', 'child')
    await commit('child.txt', 'child\n')
    await git('checkout', '-q', 'main')
    await git('merge', '-q', '--no-ff', '-m', 'land parent', 'parent')
    await push('main')
    await git('checkout', '-q', 'child')
    const found = await inspect({ baseSha: await sha('main~1'), baseRef: 'parent' })
    expect(found.commits).toHaveLength(1)
    expect(found.commits[0]).toMatchObject({ subject: 'parent.txt', how: 'ancestor' })
    expect(found.base).toBe('present')
  })

  it('proves a squash-merged parent by file contents and names every commit it covers', async () => {
    await start()
    await git('checkout', '-q', '-b', 'parent')
    await commit('one.txt', '1\n', 'parent one')
    await commit('one.txt', '1\n2\n', 'parent two')
    await push('parent')
    await git('checkout', '-q', '-b', 'child')
    await commit('child.txt', 'child\n', 'child own')
    await git('checkout', '-q', 'main')
    writeFileSync(join(dir, 'one.txt'), '1\n2\n')
    await git('add', 'one.txt')
    await git('commit', '-q', '-m', 'parent (#1)')
    await push('main')
    await git('checkout', '-q', 'child')
    const found = await inspect({ baseSha: await sha('main'), baseRef: 'parent' })
    expect(found.commits.map((entry) => [entry.subject, entry.how])).toEqual([
      ['parent one', 'content'],
      ['parent two', 'content'],
    ])
    expect(found.commitsInRange).toBe(3)
    expect(found.files).toEqual(['one.txt'])
    expect(found.base).toBe('present')
  })

  it('leaves a commit as the pull request own when the default branch holds different contents', async () => {
    await start()
    await git('checkout', '-q', '-b', 'pr')
    await commit('one.txt', '1\n')
    await git('checkout', '-q', 'main')
    await commit('one.txt', 'different\n')
    await push('main')
    await git('checkout', '-q', 'pr')
    const found = await inspect({ baseSha: await sha('main~1') })
    expect(found.commits).toEqual([])
  })

  it('counts a stack parent by shared commit or patch, and an older pull request by patch only', async () => {
    await start()
    await git('checkout', '-q', '-b', 'parent')
    await commit('parent.txt', 'parent\n')
    const parentHead = await sha('parent')
    await git('checkout', '-q', '-b', 'child')
    await commit('child.txt', 'child\n')
    await git('checkout', '-q', '-b', 'other', 'main')
    await commit('twin.txt', 'twin\n', 'twin')
    const twin = await sha('other')
    await git('checkout', '-q', 'child')
    await git('cherry-pick', twin)
    const found = await inspect({
      parents: [{ number: 5, headSha: parentHead }],
      others: [
        { number: 3, headSha: twin },
        { number: 4, headSha: await sha('child~1') },
      ],
    })
    expect(found.commits.map((entry) => [entry.subject, entry.home, entry.how])).toEqual([
      ['parent.txt', { kind: 'pull', number: 5 }, 'ancestor'],
      ['twin', { kind: 'pull', number: 3 }, 'patch'],
    ])
    expect(found.commits).toHaveLength(2)
  })

  it('records a fetch that fails and still compares what is present', async () => {
    await start()
    await git('checkout', '-q', '-b', 'pr')
    await commit('feature.txt', 'feature\n')
    const found = await inspect({
      parents: [{ number: 9, headSha: await sha('main') }],
      others: [{ number: 8, headSha: 'f'.repeat(40) }],
    })
    expect(found.problems.some((problem) => problem.includes('#8'))).toBe(true)
    expect(found.commits).toEqual([])
  })

  it('says the base branch is gone when origin has no such branch, and unknown when it cannot ask', async () => {
    await start()
    await git('checkout', '-q', '-b', 'pr')
    await commit('feature.txt', 'feature\n')
    expect((await inspect({ baseRef: 'deleted-parent' })).base).toBe('missing')
    await git('remote', 'set-url', 'origin', join(root, 'nowhere.git'))
    expect((await inspect({ baseRef: 'deleted-parent' })).base).toBe('unknown')
    expect((await inspect({ baseRef: null })).base).toBe('none')
  })

  it('works without an origin/HEAD: nothing is compared against a default branch', async () => {
    await git('init', '-q', '-b', 'main')
    await commit('base.txt', BASE_TEXT)
    await git('checkout', '-q', '-b', 'pr')
    await commit('feature.txt', 'feature\n')
    const found = await inspect({ baseSha: await sha('main') })
    expect(found).toMatchObject({ commits: [], defaultBranch: null, commitsInRange: 1 })
  })

  it('reports an unfetchable default branch as a problem', async () => {
    await start()
    await git('checkout', '-q', '-b', 'pr')
    await commit('feature.txt', 'feature\n')
    await git('remote', 'set-url', 'origin', join(root, 'nowhere.git'))
    const found = await inspect()
    expect(found.problems[0]).toContain('default branch could not be fetched')
    expect(found.defaultBranch).toBe('main')
  })

  it('treats unrelated histories as the pull request own, with the reason', async () => {
    await start()
    await git('checkout', '-q', '--orphan', 'island')
    await commit('island.txt', 'island\n')
    const found = await inspect({ baseSha: await sha('main') })
    expect(found.commits).toEqual([])
    expect(found.problems).toContain('The base and the head share no ancestor.')
  })

  it('compares nothing in a range over the cap', async () => {
    await start()
    await git('checkout', '-q', '-b', 'pr')
    for (let at = 0; at <= 200; at += 1) await git('commit', '-q', '--allow-empty', '-m', `c${at}`)
    const found = await inspect()
    expect(found.commits).toEqual([])
    expect(found.problems.join(' ')).toContain('More than 200 commits')
  })

  it('reports git failing as a problem and claims nothing', async () => {
    await start()
    const broken = async (argv: string[]) => {
      if (argv.includes('log')) throw new Error('boom\nsecond line')
      return runGit(argv)
    }
    const found = await inspectCarried(broken, dir, await args())
    expect(found.commits).toEqual([])
    expect(found.problems).toContain('Git could not find carried commits: boom')
  })

  it('reports a thrown non-error as its text', async () => {
    await start()
    const broken = async (argv: string[]): Promise<string> => {
      if (argv.includes('log')) throw 'plain text'
      return runGit(argv)
    }
    const found = await inspectCarried(broken, dir, await args())
    expect(found.problems).toContain('Git could not find carried commits: plain text')
  })

  it('names no default branch when over the cap in a clone that does not know it', async () => {
    await git('init', '-q', '-b', 'main')
    await commit('base.txt', BASE_TEXT)
    const base = await sha('main')
    for (let at = 0; at <= 200; at += 1) await git('commit', '-q', '--allow-empty', '-m', `c${at}`)
    const found = await inspect({ baseSha: base })
    expect(found).toMatchObject({ commits: [], defaultBranch: null })
  })
})
