import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

import { defaultExec } from '../benchmark/exec.mts'
import type { FocusPoint } from '../focus.mts'
import { buildNamedPrFacts, namedPullRequests } from './focus-named-prs.mts'

const req = (point: string): FocusPoint => ({ point, origin: 'requester' })

describe('namedPullRequests', () => {
  it.each([
    ['See #12', [12]],
    ['same as PR 13', [13]],
    ['same as pr #14.', [14]],
    ['like pull request 15 does', [15]],
    ['like Pull Request #16', [16]],
    ['pull  request  17', [17]],
  ])('reads %s', (point, expected) => {
    expect(namedPullRequests([req(point)])).toEqual(expected)
  })

  it('ignores near misses, the reviewed pull request and target points', () => {
    expect(namedPullRequests([req('C#12 and a&#39; and PR12 and #12a and issue 5')])).toEqual([])
    expect(namedPullRequests([req('this is #9 and PR 9')], 9)).toEqual([])
    expect(namedPullRequests([{ point: 'see #4', origin: 'target:guard' }])).toEqual([])
  })

  it('keeps the first three distinct numbers in order of appearance', () => {
    const points = [req('#5 then #6 then #5'), req('PR 7 and pull request 8, #6')]
    expect(namedPullRequests(points)).toEqual([5, 6, 7])
  })
})

let root: string
let origin: string
let tree: string
let base: string
let here: string
let other: string

const git = (cwd: string, ...args: string[]) =>
  defaultExec(
    'git',
    ['-c', 'user.name=t', '-c', 'user.email=t@example.test', '-c', 'commit.gpgsign=false', ...args],
    { cwd },
  )
const put = (dir: string, file: string, text: string) => {
  mkdirSync(dirname(join(dir, file)), { recursive: true })
  writeFileSync(join(dir, file), text)
}
const commit = async (dir: string, message: string) => {
  await git(dir, 'add', '-A')
  await git(dir, 'commit', '-q', '-m', message)
  return (await git(dir, 'rev-parse', 'HEAD')).trim()
}

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'named-prs-'))
  origin = join(root, 'origin')
  mkdirSync(origin)
  await git(origin, 'init', '-q', '-b', 'main')
  await git(origin, 'config', 'uploadpack.allowAnySHA1InWant', 'true')
  put(origin, 'docs/a.md', 'a\n')
  put(origin, 'docs/c.md', 'c\n')
  put(origin, 'src/keep.ts', 'keep\n')
  base = await commit(origin, 'base')
  await git(origin, 'checkout', '-q', '-b', 'here')
  put(origin, 'docs/a.md', 'a here\n')
  put(origin, 'src/here.ts', 'here\n')
  here = await commit(origin, 'here')
  await git(origin, 'checkout', '-q', 'main')
  await git(origin, 'checkout', '-q', '-b', 'other')
  put(origin, 'docs/a.md', 'a other\n')
  await git(origin, 'mv', 'docs/c.md', 'docs/c2.md')
  put(origin, 'docs/d.md', 'd\n')
  other = await commit(origin, 'other')
  await git(origin, 'update-ref', 'refs/pull/7/head', other)
  await git(origin, 'checkout', '-q', 'main')
  tree = join(root, 'tree')
  await git(root, 'clone', '-q', '--branch', 'here', origin, tree)
})
afterAll(() => rmSync(root, { recursive: true, force: true }))

const input = () => ({ tree, baseSha: base, headSha: here, exec: defaultExec })

describe('buildNamedPrFacts', () => {
  it('runs no git command when no pull request is named', async () => {
    const exec = vi.fn()
    expect(await buildNamedPrFacts([], { ...input(), exec })).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })

  it('fetches the pull request head and marks the files this pull request also changes', async () => {
    const [fact] = await buildNamedPrFacts([7], input())
    expect(fact).toEqual({
      number: 7,
      head: other.slice(0, 12),
      files: {
        total: 3,
        shared: 1,
        omitted: 0,
        listed: [
          { path: 'docs/a.md', status: 'modified', shared: true },
          { path: 'docs/c2.md', oldPath: 'docs/c.md', status: 'renamed', shared: false },
          { path: 'docs/d.md', status: 'added', shared: false },
        ],
      },
    })
  })

  it('uses a pinned commit already in the checkout without fetching', async () => {
    const exec = vi.fn(defaultExec)
    const [fact] = await buildNamedPrFacts([7], { ...input(), exec, refs: { '7': other } })
    expect(fact?.head).toBe(other.slice(0, 12))
    expect(exec.mock.calls.some(([, args]) => args.includes('fetch'))).toBe(false)
  })

  it('fetches a pinned commit by sha when the checkout lacks it', async () => {
    const lonely = join(root, 'lonely')
    await git(
      root,
      'clone',
      '-q',
      '--no-local',
      '--single-branch',
      '--branch',
      'here',
      origin,
      lonely,
    )
    await expect(git(lonely, 'cat-file', '-e', `${other}^{commit}`)).rejects.toThrow()
    const [fact] = await buildNamedPrFacts([7], { ...input(), tree: lonely, refs: { '7': other } })
    expect(fact?.files?.total).toBe(3)
  })

  it('ignores a pin that is not a full commit and reads the live ref', async () => {
    const [fact] = await buildNamedPrFacts([7], { ...input(), refs: { '7': 'abc' } })
    expect(fact?.head).toBe(other.slice(0, 12))
  })

  it('degrades to an unreadable pull request when the fetch fails, and keeps going', async () => {
    const facts = await buildNamedPrFacts([99, 7], input())
    expect(facts[0]).toEqual({ number: 99, head: null, files: null })
    expect(facts[1]?.head).toBe(other.slice(0, 12))
  })

  it('cannot read any pull request without the review range, and runs no git command', async () => {
    const exec = vi.fn()
    const facts = await buildNamedPrFacts([7], { tree, exec })
    expect(facts).toEqual([{ number: 7, head: null, files: null }])
    expect(exec).not.toHaveBeenCalled()
  })

  it('lists the files with the overlap unknown when this pull request own diff cannot be read', async () => {
    const [fact] = await buildNamedPrFacts([7], { ...input(), headSha: '0'.repeat(40) })
    expect(fact?.files).toMatchObject({ total: 3, shared: null })
    expect(fact?.files?.listed.map((file) => file.shared)).toEqual([null, null, null])
  })

  it('reports zero shared files, not unknown, when this pull request changes nothing', async () => {
    const [fact] = await buildNamedPrFacts([7], { ...input(), headSha: base })
    expect(fact?.files).toMatchObject({ total: 3, shared: 0 })
    expect(fact?.files?.listed.map((file) => file.shared)).toEqual([false, false, false])
  })

  it('compares against this pull request merge base, so files only the advanced base changed do not count', async () => {
    await git(origin, 'checkout', '-q', '-b', 'adv', base)
    put(origin, 'docs/base-only.md', 'base moved\n')
    const advanced = await commit(origin, 'base advanced')
    await git(origin, 'checkout', '-q', '-b', 'pr10', base)
    put(origin, 'docs/base-only.md', 'named pr\n')
    const named = await commit(origin, 'named')
    await git(origin, 'update-ref', 'refs/pull/10/head', named)
    await git(origin, 'checkout', '-q', 'main')
    const clone = join(root, 'advanced')
    await git(root, 'clone', '-q', '--branch', 'here', origin, clone)
    const [fact] = await buildNamedPrFacts([10], {
      tree: clone,
      baseSha: advanced,
      headSha: here,
      exec: defaultExec,
    })
    expect(fact?.files).toMatchObject({ total: 1, shared: 0 })
    expect(fact?.files?.listed).toEqual([
      { path: 'docs/base-only.md', status: 'added', shared: false },
    ])
  })

  it('caps the list at 200 files, shared files first, and counts the rest', async () => {
    const big = join(root, 'big')
    await git(root, 'clone', '-q', '--branch', 'here', origin, big)
    await git(big, 'checkout', '-q', '-b', 'many', base)
    for (let i = 0; i < 205; i += 1) put(big, `gen/f${String(i).padStart(3, '0')}.txt`, `${i}\n`)
    put(big, 'docs/a.md', 'a many\n')
    await commit(big, 'many')
    await git(big, 'push', '-q', 'origin', 'many:refs/pull/8/head')
    const [fact] = await buildNamedPrFacts([8], {
      tree: big,
      baseSha: base,
      headSha: here,
      exec: defaultExec,
    })
    expect(fact?.files).toMatchObject({ total: 206, shared: 1, omitted: 6 })
    expect(fact?.files?.listed).toHaveLength(200)
    expect(fact?.files?.listed[0]?.path).toBe('docs/a.md')
  })
})
