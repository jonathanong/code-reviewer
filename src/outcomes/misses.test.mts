import { describe, expect, it } from 'vitest'

import { collectOutcomes } from './collect.mts'
import { fakeGh, HEAD, io, review, seeded, thread } from './github-fake-io.mts'
import type { FakePull } from './github-fake-io.mts'
import { COVERED_LINE_WINDOW, covers, SUMMARY_MAX } from './misses.mts'

const OPTIONS = { repos: ['acme/widgets'], owner: undefined, pr: undefined, sinceDays: 30 }
const CODERABBIT = 'coderabbitai[bot]'

async function missesOf(pull: FakePull, git = `${HEAD}\n`) {
  const gh = fakeGh({ 7: { reviews: [review(100)], ...pull } })
  const found = await collectOutcomes(OPTIONS, seeded(), io({ git: async () => git }, gh))
  return found.misses
}

type Options = Parameters<typeof thread>[0]

/** Another reviewer's thread, outdated so the commit that changed its lines counts. */
const theirs = (id: number, over: Partial<Options> = {}) =>
  thread({ id, author: CODERABBIT, outdated: true, ...over })

const keys = (misses: { key: string }[]) => misses.map((miss) => miss.key)

describe('candidate misses', () => {
  it('records another reviewer thread that a later commit changed and none of ours covers', async () => {
    const misses = await missesOf({
      threads: [
        theirs(5, { path: 'src/b.ts', line: 30, startLine: 28, body: '  \nUse a map here\nmore' }),
      ],
    })
    expect(misses).toEqual([
      {
        repo: 'acme/widgets',
        pr: 7,
        key: 'acme/widgets#7/thread/5',
        path: 'src/b.ts',
        line: 30,
        reviewer: CODERABBIT,
        url: 'https://example.test/comment/5',
        summary: 'Use a map here',
        checkedAt: '2026-06-10T12:00:00.000Z',
      },
    ])
  })

  it('truncates the first line of their comment, and keeps an empty one empty', async () => {
    const [long] = await missesOf({ threads: [theirs(5, { body: 'x'.repeat(500) })] })
    expect(long?.summary).toHaveLength(SUMMARY_MAX)
    expect(long?.summary.endsWith('…')).toBe(true)
    const [empty] = await missesOf({ threads: [theirs(5, { body: '' })] })
    expect(empty?.summary).toBe('')
  })

  it('is not a candidate when the lines did not change, or the thread is neither resolved nor outdated', async () => {
    expect(await missesOf({ threads: [theirs(5)] }, '')).toEqual([])
    expect(await missesOf({ threads: [thread({ id: 5, author: CODERABBIT })] })).toEqual([])
  })

  it('is covered by our finding on the same path within the window', async () => {
    const near = theirs(5, { line: 14 + COVERED_LINE_WINDOW, startLine: 14 + COVERED_LINE_WINDOW })
    const far = theirs(6, { line: 15 + COVERED_LINE_WINDOW, startLine: 15 + COVERED_LINE_WINDOW })
    const other = theirs(7, { path: 'src/other.ts' })
    const misses = await missesOf({ threads: [thread({ id: 1 }), near, far, other] })
    expect(keys(misses)).toEqual(['acme/widgets#7/thread/6', 'acme/widgets#7/thread/7'])
  })

  it('is covered by our finding at a head the tracker does not list', async () => {
    const reviews = [review(100), review(150)]
    const threads = [thread({ id: 2, review: 150 }), theirs(6)]
    expect(await missesOf({ reviews, threads })).toEqual([])
  })

  it('is covered by a finding of ours in a review body, and not by one with no path', async () => {
    const body = (title: string) =>
      `<details><summary>[low · design] ${title}</summary>\n\nx</details>`
    const located = [review(100, { body: body('Naming (src/a.ts:20)') })]
    expect(await missesOf({ reviews: located, threads: [theirs(5)] })).toEqual([])
    const unlocated = [review(100, { body: body('Naming') })]
    expect(await missesOf({ reviews: unlocated, threads: [theirs(5)] })).toHaveLength(1)
  })

  it('a finding or a thread with no lines covers its whole file', async () => {
    const wholeFile = thread({ id: 1, line: null, startLine: null })
    const far = theirs(5, { line: 400, startLine: 400 })
    expect(await missesOf({ threads: [wholeFile, far] })).toEqual([])
    const fileLevel = theirs(6, { line: null, startLine: null })
    expect(await missesOf({ threads: [thread({ id: 1 }), fileLevel] })).toEqual([])
  })

  it('skips our own login, notices, bots that never review, and threads with no author or path', async () => {
    const bare = (id: number, author: { login: string } | null, path: string | null) => ({
      isResolved: false,
      isOutdated: true,
      comments: { nodes: [{ databaseId: id, body: 'b', path, author }] },
    })
    const threads = [
      theirs(1, { author: 'reviewer[bot]', review: 150, path: 'src/z.ts' }),
      theirs(2, { author: 'codecov[bot]', path: 'src/z.ts' }),
      theirs(4, { path: 'src/z.ts', body: 'You have hit your usage limits' }),
      bare(6, null, 'src/z.ts'),
      bare(7, { login: 'someone' }, null),
      { isResolved: false, isOutdated: true, comments: { nodes: [] } },
    ]
    expect(await missesOf({ threads })).toEqual([])
  })

  it('reports a thread it cannot compare and does not call it a miss', async () => {
    const threads = [theirs(5, { path: 'src/z.ts' })]
    const gh = fakeGh({ 7: { reviews: [review(100)], threads } }, new Error('boom'))
    const git = async () => {
      throw new Error('no commit')
    }
    const found = await collectOutcomes(OPTIONS, seeded(), io({ git }, gh))
    expect(found.misses).toEqual([])
    expect(found.problems.join()).toContain('could not tell whether src/z.ts changed')
  })
})

describe('covers', () => {
  const at = (start: number | null, end: number | null, path = 'a') => ({ path, start, end })

  it('needs the same path and a range within the window', () => {
    expect(covers(at(10, 12), at(12, 14))).toBe(true)
    expect(covers(at(10, 12), at(12 + COVERED_LINE_WINDOW, 13 + COVERED_LINE_WINDOW))).toBe(true)
    expect(covers(at(10, 12), at(13 + COVERED_LINE_WINDOW, 20 + COVERED_LINE_WINDOW))).toBe(false)
    expect(covers(at(40, 42), at(10, 39 - COVERED_LINE_WINDOW))).toBe(false)
    expect(covers(at(10, 12), at(10, 12, 'b'))).toBe(false)
  })

  it('a missing line on either side covers the whole file', () => {
    expect(covers(at(null, null), at(99, 99))).toBe(true)
    expect(covers(at(10, 12), at(null, null))).toBe(true)
    expect(covers(at(10, null), at(99, 99))).toBe(true)
    expect(covers(at(10, 12), at(99, null))).toBe(true)
  })
})
