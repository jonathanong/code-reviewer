import { describe, expect, it, vi } from 'vitest'

import { localPullDiff } from './local-diff.mts'
import { createGhPrepareIo } from './prepare-io.mts'

const target = { repo: 'o/r', pr: 7 }

function gitFake() {
  return vi.fn(async (args: readonly string[]) => {
    if (args[2] === 'merge-base') return 'mmm\n'
    return args[2] === 'diff' ? 'LOCAL' : ''
  })
}

describe('localPullDiff', () => {
  it('fetches both commits and diffs the merge base against the head', async () => {
    const run = vi.fn(async () => '{"baseRefOid":"bbb","headRefOid":"hhh"}')
    const git = gitFake()
    expect(await localPullDiff(target, run, git, '/tree')).toBe('LOCAL')
    expect(git.mock.calls.map(([args]) => args.slice(2))).toEqual([
      ['fetch', '--quiet', 'origin', 'bbb', 'hhh'],
      ['merge-base', 'bbb', 'hhh'],
      ['diff', '--no-color', '--no-ext-diff', 'mmm', 'hhh'],
    ])
  })
})

describe('createGhPrepareIo diff', () => {
  const run = vi.fn(async (args: readonly string[]) =>
    args[1] === 'diff' ? 'REMOTE' : '{"baseRefOid":"bbb","headRefOid":"hhh"}',
  )

  it('diffs in the tree when there is one', async () => {
    const io = createGhPrepareIo(
      target,
      run,
      gitFake(),
      async () => undefined,
      undefined,
      '/nowhere',
    )
    expect(await io.diff('/tree')).toBe('LOCAL')
  })

  it('asks GitHub without a tree, or when git fails', async () => {
    const io = createGhPrepareIo(
      target,
      run,
      gitFake(),
      async () => undefined,
      undefined,
      '/nowhere',
    )
    expect(await io.diff()).toBe('REMOTE')
    const git = vi.fn(async () => Promise.reject(new Error('no such commit')))
    const broken = createGhPrepareIo(target, run, git, async () => undefined, undefined, '/nowhere')
    expect(await broken.diff('/tree')).toBe('REMOTE')
  })
})

describe('createGhPrepareIo memberDiff', () => {
  const member = { number: 9, title: 'T', headRef: 'h', baseRef: 'b', headSha: 'hhh' }

  it('diffs a stack member in the tree by sha, without the API', async () => {
    const run = vi.fn(async () => 'API')
    const git = gitFake()
    const io = createGhPrepareIo(target, run, git, [], undefined, '/nowhere')
    expect(await io.memberDiff(member, 'bbb', '/tree')).toBe('LOCAL')
    expect(git.mock.calls.map(([args]) => args.slice(2))).toEqual([
      ['fetch', '--quiet', 'origin', 'bbb', 'hhh'],
      ['merge-base', 'bbb', 'hhh'],
      ['diff', '--no-color', '--no-ext-diff', 'mmm', 'hhh'],
    ])
    expect(run).not.toHaveBeenCalled()
  })

  it('falls back to the API without a tree or when git fails', async () => {
    const run = vi.fn(async (_args: readonly string[]) => 'API')
    const failing = vi.fn(async () => Promise.reject(new Error('no such commit')))
    const io = createGhPrepareIo(target, run, failing, [], undefined, '/nowhere')
    expect(await io.memberDiff(member, 'bbb', '/tree')).toBe('API')
    expect(await io.memberDiff(member, 'bbb')).toBe('API')
    expect(run).toHaveBeenCalledWith(['pr', 'diff', '9', '-R', 'o/r', '--color', 'never'])
  })

  it('rejects when GitHub refuses a diff above 300 files and there is no local diff', async () => {
    const tooLarge = new Error('HTTP 406 PullRequest.diff too_large')
    const run = vi.fn(async () => Promise.reject(tooLarge))
    const io = createGhPrepareIo(target, run, gitFake(), [], undefined, '/nowhere')
    await expect(io.memberDiff(member, 'bbb')).rejects.toBe(tooLarge)
  })
})

describe('createGhPrepareIo stackInput', () => {
  it('reads the open pull requests and the default branch', async () => {
    const run = vi.fn(async (args: readonly string[]) =>
      args.includes('.default_branch')
        ? 'main\n'
        : '{"number":7,"title":"T","headRef":"h","baseRef":"main","headSha":"s","headRepo":"o/r"}',
    )
    const io = createGhPrepareIo(target, run, gitFake(), [], undefined, '/nowhere')
    expect(await io.stackInput()).toMatchObject({ pr: 7, defaultBranch: 'main' })
  })
})
