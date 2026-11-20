import { describe, expect, it, vi } from 'vitest'

import type { QueueEntry } from './queue.mts'
import { groupStacks } from './queue-stack.mts'

const entry = (repo: string, pr: number): QueueEntry => ({
  repo,
  pr,
  headSha: 's',
  state: 'requested',
  isDraft: false,
  updatedAt: 't',
  url: 'u',
})

const row = (number: number, headRef: string, baseRef: string, headRepo = 'a/b') =>
  JSON.stringify({ number, title: 'T', headRef, baseRef, headSha: 's', headRepo })

/** Routes `repos/<repo>/pulls` to that repository's open pull requests. */
function run(pulls: Record<string, string[]>) {
  return vi.fn(async (args: readonly string[]) => {
    const repo = /repos\/([^/]+\/[^/]+)\/pulls/u.exec(args[1] ?? '')?.[1] as string
    const lines = pulls[repo]
    if (lines === undefined) throw new Error('boom')
    return lines.join('\n')
  })
}

const STACK_AB = [row(10, 'x', 'main'), row(11, 'y', 'x'), row(12, 'z', 'y'), row(20, 'f', 'main')]

describe('groupStacks', () => {
  it('marks stacked entries and groups their members bottom-up where the first was listed', async () => {
    const entries = [entry('a/b', 12), entry('a/b', 20), entry('a/b', 10)]
    const grouped = await groupStacks(run({ 'a/b': STACK_AB }), entries)
    expect(grouped.map((item) => item.pr)).toEqual([10, 12, 20])
    expect(grouped[0]?.stack).toEqual({ root: 10, position: 1, size: 3 })
    expect(grouped[1]?.stack).toEqual({ root: 10, position: 3, size: 3 })
    expect(grouped[2]?.stack).toBeUndefined()
  })

  it('gives every member of a branching stack the same size and order', async () => {
    const pulls = [row(10, 'x', 'main'), row(11, 'y', 'x'), row(12, 'z', 'x'), row(13, 'w', 'y')]
    const entries = [entry('a/b', 12), entry('a/b', 13), entry('a/b', 11), entry('a/b', 10)]
    const grouped = await groupStacks(run({ 'a/b': pulls }), entries)
    expect(grouped.map((item) => item.pr)).toEqual([10, 11, 13, 12])
    expect(grouped.map((item) => item.stack)).toEqual(
      [1, 2, 3, 4].map((position) => ({ root: 10, position, size: 4 })),
    )
  })

  it('falls back to its own walk for a member beyond the root walk cap', async () => {
    const wide = Array.from({ length: 22 }, (_, at) => row(11 + at, `c${at}`, 'x'))
    const grouped = await groupStacks(run({ 'a/b': [row(10, 'x', 'main'), ...wide] }), [
      entry('a/b', 32),
    ])
    expect(grouped[0]?.stack).toEqual({ root: 10, position: 2, size: 2 })
  })

  it('keeps flat rows in order around a stack', async () => {
    const entries = [entry('a/b', 20), entry('a/b', 11), entry('a/b', 30), entry('a/b', 10)]
    const pulls = [...STACK_AB, row(30, 'g', 'main')]
    const grouped = await groupStacks(run({ 'a/b': pulls }), entries)
    expect(grouped.map((item) => item.pr)).toEqual([20, 10, 11, 30])
  })

  it('reads open pull requests once per repository and keeps repositories apart', async () => {
    const calls = run({ 'a/b': STACK_AB, 'c/d': [row(10, 'x', 'main', 'c/d')] })
    const grouped = await groupStacks(calls, [entry('a/b', 10), entry('c/d', 10), entry('A/B', 11)])
    expect(calls).toHaveBeenCalledTimes(2)
    expect(grouped.map((item) => `${item.repo}#${item.pr}`)).toEqual(['a/b#10', 'A/B#11', 'c/d#10'])
    expect(grouped[2]?.stack).toBeUndefined()
  })

  it('leaves the rows as they are when open pull requests cannot be listed', async () => {
    const entries = [entry('x/y', 2), entry('x/y', 1)]
    expect(await groupStacks(run({}), entries)).toEqual(entries)
  })

  it('returns nothing for an empty queue', async () => {
    expect(await groupStacks(run({}), [])).toEqual([])
  })
})
