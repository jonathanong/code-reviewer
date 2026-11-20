import { describe, expect, it } from 'vitest'

import { detectStack, summarizeStack, walkStack, type StackMember } from './stack.mts'

const pull = (number: number, headRef: string, baseRef: string): StackMember => ({
  number,
  title: `T${number}`,
  headRef,
  baseRef,
  headSha: `sha${number}`,
})

const CHAIN = [pull(3, 'c', 'b'), pull(1, 'a', 'main'), pull(2, 'b', 'a')]
const numbers = (members: StackMember[] | undefined) => (members ?? []).map((m) => m.number)

describe('walkStack', () => {
  it('orders members bottom-up from any position', () => {
    for (const [pr, index] of [
      [1, 0],
      [2, 1],
      [3, 2],
    ] as const) {
      const walk = walkStack(pr, CHAIN)
      expect(numbers(walk?.members)).toEqual([1, 2, 3])
      expect(walk).toMatchObject({ index, rootBase: 'main' })
    }
  })

  it('returns undefined when the pull request is not open', () => {
    expect(walkStack(9, CHAIN)).toBeUndefined()
  })

  it('records every child of a branching stack and follows each chain', () => {
    const pulls = [pull(1, 'a', 'main'), pull(2, 'b', 'a'), pull(3, 'c', 'a'), pull(4, 'd', 'b')]
    expect(numbers(walkStack(1, pulls)?.members)).toEqual([1, 2, 4, 3])
  })

  it('stops on a cycle of branch names', () => {
    const pulls = [pull(1, 'a', 'b'), pull(2, 'b', 'a')]
    expect(numbers(walkStack(1, pulls)?.members)).toEqual([2, 1])
    expect(walkStack(2, pulls)?.members).toHaveLength(2)
  })

  it('caps the walk down at ten hops', () => {
    const pulls = Array.from({ length: 15 }, (_, at) => pull(at + 1, `b${at}`, `b${at - 1}`))
    const walk = walkStack(15, pulls)
    expect(walk?.index).toBe(10)
    expect(walk?.rootBase).toBe('b3')
  })

  it('caps the walk up at ten hops and the members above at twenty', () => {
    const line = Array.from({ length: 15 }, (_, at) => pull(at + 1, `b${at}`, `b${at - 1}`))
    expect(walkStack(1, line)?.members).toHaveLength(11)
    const fan = [
      pull(1, 'root', 'main'),
      ...Array.from({ length: 30 }, (_, at) => pull(at + 2, `f${at}`, 'root')),
    ]
    expect(walkStack(1, fan)?.members).toHaveLength(21)
  })

  it('uses the lowest pull request number when two share a head branch', () => {
    const pulls = [pull(5, 'dup', 'main'), pull(4, 'dup', 'main'), pull(6, 'x', 'dup')]
    expect(numbers(walkStack(6, pulls)?.members)).toEqual([4, 6])
  })
})

describe('detectStack', () => {
  it('is undefined for a flat pull request on the default branch', () => {
    expect(detectStack(1, [pull(1, 'a', 'main')], 'main')).toBeUndefined()
    expect(detectStack(9, [pull(1, 'a', 'main')], 'main')).toBeUndefined()
  })

  it('finds a stack rooted on the default branch', () => {
    expect(detectStack(2, CHAIN, 'main')).toMatchObject({
      rootIsDefault: true,
      staleBase: false,
      index: 1,
    })
  })

  it('marks a stack rooted elsewhere as off-base, not stale', () => {
    expect(detectStack(2, CHAIN, 'trunk')).toMatchObject({ rootIsDefault: false, staleBase: false })
  })

  it('marks a lone pull request on a missing base as stale', () => {
    expect(detectStack(1, [pull(1, 'a', 'gone')], 'main')).toMatchObject({
      rootIsDefault: false,
      staleBase: true,
    })
  })

  it('summarizes the member numbers and flags', () => {
    const stack = detectStack(2, CHAIN, 'main')
    expect(summarizeStack(stack as NonNullable<typeof stack>)).toEqual({
      members: [1, 2, 3],
      index: 1,
      rootBase: 'main',
      rootIsDefault: true,
      staleBase: false,
    })
  })
})
