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
  it('fetches the base and diffs the merge base against the head', async () => {
    const run = vi.fn(async () => '{"baseRefOid":"bbb","headRefOid":"hhh"}')
    const git = gitFake()
    expect(await localPullDiff(target, run, git, '/tree')).toBe('LOCAL')
    expect(git.mock.calls.map(([args]) => args.slice(2))).toEqual([
      ['fetch', '--quiet', 'origin', 'bbb'],
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
    const io = createGhPrepareIo(target, run, gitFake(), [], undefined, '/nowhere')
    expect(await io.diff('/tree')).toBe('LOCAL')
  })

  it('asks GitHub without a tree, or when git fails', async () => {
    const io = createGhPrepareIo(target, run, gitFake(), [], undefined, '/nowhere')
    expect(await io.diff()).toBe('REMOTE')
    const git = vi.fn(async () => Promise.reject(new Error('no such commit')))
    const broken = createGhPrepareIo(target, run, git, [], undefined, '/nowhere')
    expect(await broken.diff('/tree')).toBe('REMOTE')
  })
})
