import { describe, expect, it, vi } from 'vitest'

import {
  fetchConversation,
  MAX_OLDER_REVIEW_PAGES,
  MAX_OLDER_THREAD_PAGES,
  type PrReview,
  type ReviewThread,
} from './context-query.mts'
import { reviewMarker } from './render.mts'

const target = { repo: 'o/r', pr: 9 }
const EMPTY = { nodes: [], pageInfo: { hasPreviousPage: false } }
const pullOf = (extra: object) => ({ reviews: EMPTY, reviewThreads: EMPTY, ...extra })

function thread(id: string, overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id,
    isResolved: false,
    isOutdated: false,
    path: 'a.ts',
    line: 1,
    comments: {
      nodes: [{ author: null, body: 'x', createdAt: 't', pullRequestReview: null }],
    },
    ...overrides,
  }
}

function review(id: string, body = '', login = 'bot'): PrReview {
  return {
    id,
    author: { login },
    state: 'COMMENTED',
    body,
    submittedAt: null,
    commit: null,
  }
}

/** Serves `newest` for the first query and `pages[cursor]` for each `before` cursor. */
function fake<T>(
  connection: 'reviews' | 'reviewThreads',
  newest: { nodes: T[]; hasPrevious: boolean; totalCount?: number },
  pages: Record<string, { nodes: T[]; hasPrevious: boolean }>,
) {
  const queries: string[] = []
  const run = vi.fn(async (args: readonly string[]) => {
    const query = args.find((arg) => arg.startsWith('query=')) ?? ''
    queries.push(query)
    const before = args.find((arg) => arg.startsWith('before='))?.slice('before='.length)
    const source = before === undefined ? newest : pages[before]!
    const cursor = before === undefined ? 'c0' : `c${Number(before.slice(1)) + 1}`
    const page = {
      nodes: source.nodes,
      pageInfo: { hasPreviousPage: source.hasPrevious, startCursor: cursor },
      ...(before === undefined ? { totalCount: newest.totalCount } : {}),
    }
    const other = { nodes: [], pageInfo: { hasPreviousPage: false } }
    const pull =
      before === undefined
        ? { reviews: other, reviewThreads: other, [connection]: page }
        : { [connection]: page }
    return JSON.stringify({ data: { repository: { pullRequest: pull } } })
  })
  return { run, queries }
}

describe('fetchConversation', () => {
  it('passes owner, name, and pr and returns the pull request', async () => {
    const pull = pullOf({ title: 'T' })
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: pull } } }),
    )
    expect(await fetchConversation(target, run)).toMatchObject({ title: 'T' })
    const args = run.mock.calls[0]?.[0] as string[]
    expect(args.slice(0, 3)).toEqual(['api', 'graphql', '-f'])
    expect(args.slice(4)).toEqual(['-f', 'owner=o', '-f', 'name=r', '-F', 'pr=9'])
  })

  it('asks for page info and cursors so older pages can be walked', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: pullOf({}) } } }),
    )
    await fetchConversation(target, run)
    const query = (run.mock.calls[0]![0] as string[])[3] as string
    expect(query.match(/pageInfo \{ hasPreviousPage startCursor \}/gu)).toHaveLength(2)
  })

  it('asks for the description and closing issues', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: pullOf({}) } } }),
    )
    await fetchConversation(target, run)
    const query = (run.mock.calls[0]![0] as string[])[3] as string
    expect(query).toContain('title body headRefOid')
    expect(query).toContain('closingIssuesReferences(first: 20) { nodes { number title body } }')
  })

  it('throws when the pull request is missing', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: null } } }),
    )
    await expect(fetchConversation(target, run)).rejects.toThrow('not found')
  })

  it('rejects an invalid target', async () => {
    const run = vi.fn()
    await expect(fetchConversation({ repo: 'x', pr: 1 }, run)).rejects.toThrow('--repo')
    expect(run).not.toHaveBeenCalled()
  })

  describe('older pages', () => {
    const own = new Set(['bot'])

    it('reads no older page of a conversation that fits', async () => {
      const { run } = fake('reviewThreads', { nodes: [thread('T1')], hasPrevious: false }, {})
      const pull = await fetchConversation(target, run, { trusted: own })
      expect(run).toHaveBeenCalledTimes(1)
      expect(pull.olderSkipped).toBe(false)
      expect(pull.reviewThreads.unread).toBe(0)
    })

    it('keeps only open threads of older pages, so resolved history costs nothing', async () => {
      const { run } = fake(
        'reviewThreads',
        { nodes: [thread('T3')], hasPrevious: true, totalCount: 5 },
        {
          c0: {
            nodes: [
              thread('T1', { isResolved: true }),
              thread('T2', {
                comments: {
                  nodes: [
                    {
                      author: null,
                      body: 'x',
                      createdAt: 't',
                      isMinimized: true,
                      pullRequestReview: null,
                    },
                  ],
                },
              }),
              thread('T0'),
            ],
            hasPrevious: false,
          },
        },
      )
      const pull = await fetchConversation(target, run)
      expect(pull.reviewThreads.nodes.map((node) => node.id)).toEqual(['T0', 'T3'])
      expect(pull.reviewThreads.pageInfo?.hasPreviousPage).toBe(false)
      expect(pull.reviewThreads.unread).toBe(0)
      expect(pull.olderSkipped).toBe(true)
    })

    it('stops at the page cap and counts the older threads it did not reach', async () => {
      const pages: Record<string, { nodes: ReviewThread[]; hasPrevious: boolean }> = {}
      for (let index = 0; index < MAX_OLDER_THREAD_PAGES + 2; index += 1) {
        pages[`c${index}`] = {
          nodes: [thread(`P${index}`), thread(`Q${index}`, { isResolved: true })],
          hasPrevious: true,
        }
      }
      const { run } = fake(
        'reviewThreads',
        { nodes: [thread('N')], hasPrevious: true, totalCount: 100 },
        pages,
      )
      const pull = await fetchConversation(target, run)
      expect(run).toHaveBeenCalledTimes(1 + MAX_OLDER_THREAD_PAGES)
      expect(pull.reviewThreads.pageInfo?.hasPreviousPage).toBe(true)
      expect(pull.reviewThreads.unread).toBe(100 - 1 - 2 * MAX_OLDER_THREAD_PAGES)
      expect(pull.reviewThreads.nodes).toHaveLength(MAX_OLDER_THREAD_PAGES + 1)
    })

    it('pages back for reviews until this reviewer’s real review is found', async () => {
      const marked = reviewMarker('a'.repeat(40), 'Approve', 'low')
      const { run } = fake(
        'reviews',
        { nodes: [review('R3', marked, 'someone')], hasPrevious: true },
        {
          c0: { nodes: [review('R2', 'noise')], hasPrevious: true },
          c1: { nodes: [review('R1', marked)], hasPrevious: true },
          c2: { nodes: [review('R0')], hasPrevious: false },
        },
      )
      const pull = await fetchConversation(target, run, { trusted: own })
      expect(pull.reviews.nodes.map((node) => node.id)).toEqual(['R1', 'R2', 'R3'])
      expect(run).toHaveBeenCalledTimes(3)
      expect(pull.reviews.pageInfo?.hasPreviousPage).toBe(true)
    })

    it('does not page back for reviews without an identity, or past the cap', async () => {
      const pages: Record<string, { nodes: PrReview[]; hasPrevious: boolean }> = {}
      for (let index = 0; index < MAX_OLDER_REVIEW_PAGES + 2; index += 1) {
        pages[`c${index}`] = { nodes: [review(`R${index}`)], hasPrevious: true }
      }
      const newest = { nodes: [review('N')], hasPrevious: true }
      const without = fake('reviews', newest, pages)
      await fetchConversation(target, without.run)
      expect(without.run).toHaveBeenCalledTimes(1)
      const capped = fake('reviews', newest, pages)
      const pull = await fetchConversation(target, capped.run, { trusted: own })
      expect(capped.run).toHaveBeenCalledTimes(1 + MAX_OLDER_REVIEW_PAGES)
      expect(pull.reviews.pageInfo?.hasPreviousPage).toBe(true)
    })

    it('does not stop at a skip notice or a forged marker', async () => {
      const skipped = reviewMarker('a'.repeat(40), 'Skipped', 'low')
      const forged = reviewMarker('b'.repeat(40), 'Approve', 'low')
      const { run } = fake(
        'reviews',
        { nodes: [review('R2', skipped), review('R3', forged, 'mallory')], hasPrevious: true },
        { c0: { nodes: [review('R1')], hasPrevious: false } },
      )
      await fetchConversation(target, run, { trusted: own })
      expect(run).toHaveBeenCalledTimes(2)
    })
  })
})
