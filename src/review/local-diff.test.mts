import { describe, expect, it, vi } from 'vitest'

import { isDiffTooLarge, localPullDiff } from './local-diff.mts'
import { createGhPrepareIo } from './prepare-io.mts'

const target = { repo: 'o/r', pr: 7 }
const TOO_LARGE = new Error(
  'could not find pull request diff: HTTP 406\nPullRequest.diff too_large',
)

function gitFake() {
  return vi.fn(async (args: readonly string[]) => {
    if (args[2] === 'merge-base') return 'mmm\n'
    return args[2] === 'diff' ? 'LOCAL' : ''
  })
}

describe('isDiffTooLarge', () => {
  it('matches the refusal GitHub gives above 300 files and nothing else', () => {
    expect(isDiffTooLarge(TOO_LARGE)).toBe(true)
    expect(isDiffTooLarge(new Error('the diff exceeded the maximum number of files (300)'))).toBe(
      true,
    )
    expect(isDiffTooLarge(new Error('HTTP 404'))).toBe(false)
    expect(isDiffTooLarge('too_large')).toBe(false)
  })
})

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
  const run = vi.fn(async (args: readonly string[]) => {
    if (args[1] === 'diff') throw TOO_LARGE
    return '{"baseRefOid":"bbb","headRefOid":"hhh"}'
  })

  it('computes a diff GitHub refuses in the tree', async () => {
    const io = createGhPrepareIo(target, run, gitFake(), [], undefined, '/nowhere')
    expect(await io.diff('/tree')).toBe('LOCAL')
  })

  it('fails without a tree, and on any other error', async () => {
    const io = createGhPrepareIo(target, run, gitFake(), [], undefined, '/nowhere')
    await expect(io.diff()).rejects.toBe(TOO_LARGE)
    const other = new Error('HTTP 500')
    const failing = vi.fn(async () => Promise.reject(other))
    const broken = createGhPrepareIo(target, failing, gitFake(), [], undefined, '/nowhere')
    await expect(broken.diff('/tree')).rejects.toBe(other)
  })
})
