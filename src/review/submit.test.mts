import { describe, expect, it, vi } from 'vitest'

import { createRetrier } from '../gh-cli/index.mts'
import type { SanitizedReview } from '../review-payload/index.mts'
import { ReviewError } from './finding.mts'
import { ReviewRejectedError, type ListedReview, type ReviewIo } from './github.mts'
import { reviewMarker } from './render.mts'
import { postReviews } from './submit.mts'

const SHA = 'c'.repeat(40)
const OTHER = 'd'.repeat(40)

const first = (head = SHA): SanitizedReview => ({
  event: 'COMMENT',
  commit_id: head,
  body: `${reviewMarker(head, 'Comment', 'high')}\nbody`,
  comments: [],
})
const second = (head = SHA): SanitizedReview => ({
  event: 'COMMENT',
  commit_id: head,
  body: `<!-- final-review-part sha=${head} part=2 -->\nmore`,
  comments: [],
})

const listed = (id: number, body: string, author: string | null = 'bot'): ListedReview => ({
  id,
  url: `https://example.test/review/${id}`,
  body,
  author,
})

function retrier() {
  const sleeps: number[] = []
  const value = createRetrier({
    sleep: async (ms) => {
      sleeps.push(ms)
    },
    random: () => 0,
  })
  return { sleeps, value }
}

/** A pull request whose `postReview` runs `behave` first and may still create the review. */
function pull(existing: ListedReview[] = []) {
  const reviews = [...existing]
  const land = (review: SanitizedReview) => {
    const id = 100 + reviews.length
    reviews.push(listed(id, review.body))
    return `https://example.test/review/${id}`
  }
  const io = {
    trustedAuthors: vi.fn(async () => new Set(['bot'])),
    listReviews: vi.fn(async () => [...reviews]),
    postReview: vi.fn(async (review: SanitizedReview) => land(review)),
  }
  return { io: io satisfies Partial<ReviewIo> as unknown as ReviewIo, mocks: io, reviews, land }
}

describe('postReviews confirmation', () => {
  it('confirms one review landed, by id and link', async () => {
    const { io } = pull()
    await expect(postReviews(io, [first()], retrier().value)).resolves.toMatchObject({
      urls: ['https://example.test/review/100'],
      confirmed: [{ id: 100, url: 'https://example.test/review/100' }],
      warnings: [],
    })
  })

  it('confirms each part of a split review', async () => {
    const { io } = pull()
    const result = await postReviews(io, [first(), second()], retrier().value)
    expect(result.confirmed.map(({ id }) => id)).toEqual([100, 101])
    expect(result.urls).toEqual(result.confirmed.map(({ url }) => url))
  })

  it('does not count an earlier review of the same head, or someone else’s', async () => {
    const earlier = listed(5, first().body)
    const forged = listed(6, first().body, 'mallory')
    const anonymous = listed(8, first().body, null)
    const { io } = pull([earlier, forged, anonymous])
    const result = await postReviews(io, [first()], retrier().value)
    expect(result.confirmed).toEqual([{ id: 100 + 3, url: 'https://example.test/review/103' }])
    expect(result.warnings).toEqual([])
  })

  it.each([
    ['another head', first(OTHER).body],
    ['another part', second().body],
  ])('does not count a review for %s', async (_name, body) => {
    const { io, mocks, land } = pull()
    mocks.postReview.mockImplementationOnce(async (review) => {
      land({ ...review, body })
      return 'https://example.test/lost'
    })
    await expect(postReviews(io, [first()], retrier().value)).rejects.toThrow(ReviewError)
  })

  it('errors, not success, when a submitted review is not on the pull request', async () => {
    const { io, mocks } = pull()
    mocks.postReview.mockResolvedValueOnce('https://example.test/phantom')
    await expect(postReviews(io, [first()], retrier().value)).rejects.toMatchObject({
      name: 'ReviewError',
      message: expect.stringContaining('https://example.test/phantom'),
    })
  })

  it('warns, naming every copy, when a part exists more than once, and removes nothing', async () => {
    const { io, mocks, land } = pull()
    mocks.postReview.mockImplementationOnce(async (review) => {
      land(review)
      return land(review)
    })
    const result = await postReviews(io, [first()], retrier().value)
    expect(result.confirmed).toEqual([{ id: 100, url: 'https://example.test/review/100' }])
    expect(result.warnings).toEqual([
      expect.stringContaining('https://example.test/review/100, https://example.test/review/101'),
    ])
  })

  it('says the review was submitted but unconfirmed when the read-back fails', async () => {
    const { io, mocks } = pull()
    mocks.listReviews.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('HTTP 502'))
    const result = await postReviews(io, [first()], retrier().value)
    expect(result.confirmed).toEqual([])
    expect(result.urls).toEqual(['https://example.test/review/100'])
    expect(result.warnings).toEqual([expect.stringContaining('could not be confirmed')])
  })

  it.each([
    [
      'no trusted identity',
      (m: ReturnType<typeof pull>['mocks']) => m.trustedAuthors.mockResolvedValue(new Set()),
    ],
    [
      'an unreadable identity',
      (m: ReturnType<typeof pull>['mocks']) => m.trustedAuthors.mockRejectedValue(new Error('x')),
    ],
    [
      'an unreadable review list',
      (m: ReturnType<typeof pull>['mocks']) => m.listReviews.mockRejectedValueOnce(new Error('x')),
    ],
  ])('posts once and reports unconfirmed with %s', async (_name, arrange) => {
    const { io, mocks } = pull()
    arrange(mocks)
    const result = await postReviews(io, [first()], retrier().value)
    expect(mocks.postReview).toHaveBeenCalledOnce()
    expect(result.confirmed).toEqual([])
    expect(result.warnings).toEqual([expect.stringContaining('could not be confirmed')])
  })

  it('posts nothing and confirms nothing for no parts', async () => {
    const { io, mocks } = pull()
    await expect(postReviews(io, [], retrier().value)).resolves.toEqual({
      urls: [],
      event: 'COMMENT',
      confirmed: [],
      warnings: [],
    })
    expect(mocks.listReviews).not.toHaveBeenCalled()
  })
})

describe('postReviews retry', () => {
  it('retries a transient failure when the review did not land, and confirms the retry', async () => {
    const { io, mocks } = pull()
    mocks.postReview.mockRejectedValueOnce(new Error('HTTP 504: Gateway Timeout'))
    const { value, sleeps } = retrier()
    const result = await postReviews(io, [first()], value)
    expect(mocks.postReview).toHaveBeenCalledTimes(2)
    expect(result.confirmed).toHaveLength(1)
    expect(result.warnings).toEqual([])
    expect(value.stats.retries).toBe(1)
    expect(sleeps).toHaveLength(1)
  })

  it('does not post again when a timed-out post had landed', async () => {
    const { io, mocks, land } = pull()
    mocks.postReview.mockImplementationOnce(async (review) => {
      land(review)
      throw new Error('read tcp: i/o timeout')
    })
    const { value } = retrier()
    const result = await postReviews(io, [first()], value)
    expect(mocks.postReview).toHaveBeenCalledOnce()
    expect(result.confirmed).toEqual([{ id: 100, url: 'https://example.test/review/100' }])
    expect(result.urls).toEqual(['https://example.test/review/100'])
    expect(value.stats.retries).toBe(0)
  })

  it('gives up with the last error once the attempts are spent', async () => {
    const { io, mocks } = pull()
    mocks.postReview.mockRejectedValue(new Error('HTTP 503: down'))
    await expect(postReviews(io, [first()], retrier().value)).rejects.toThrow('HTTP 503')
    expect(mocks.postReview).toHaveBeenCalledTimes(3)
  })

  it.each(['HTTP 401: Bad credentials', 'HTTP 404: Not Found', 'spawn gh ENOENT'])(
    'fails a permanent error at once without reading back: %s',
    async (message) => {
      const { io, mocks } = pull()
      mocks.postReview.mockRejectedValue(new Error(message))
      await expect(postReviews(io, [first()], retrier().value)).rejects.toThrow(message)
      expect(mocks.postReview).toHaveBeenCalledOnce()
      expect(mocks.listReviews).toHaveBeenCalledOnce()
    },
  )

  it('does not retry when it cannot tell whether the review landed', async () => {
    const noBaseline = pull()
    noBaseline.mocks.trustedAuthors.mockResolvedValue(new Set())
    noBaseline.mocks.postReview.mockRejectedValue(new Error('HTTP 502: Bad Gateway'))
    await expect(postReviews(noBaseline.io, [first()], retrier().value)).rejects.toThrow(
      /may have posted/u,
    )
    expect(noBaseline.mocks.postReview).toHaveBeenCalledOnce()
    const noReadBack = pull()
    noReadBack.mocks.postReview.mockRejectedValue(new Error('HTTP 502: Bad Gateway'))
    noReadBack.mocks.listReviews.mockResolvedValueOnce([]).mockRejectedValue(new Error('HTTP 502'))
    await expect(postReviews(noReadBack.io, [first()], retrier().value)).rejects.toThrow(
      /may have posted/u,
    )
    expect(noReadBack.mocks.postReview).toHaveBeenCalledOnce()
  })

  it('retries the later part only, never the part that landed', async () => {
    const { io, mocks, land } = pull()
    mocks.postReview
      .mockImplementationOnce(async (review) => land(review))
      .mockRejectedValueOnce(new Error('connection reset by peer'))
    const result = await postReviews(io, [first(), second()], retrier().value)
    const bodies = mocks.postReview.mock.calls.map(([review]) => review.body)
    expect(bodies).toEqual([first().body, second().body, second().body])
    expect(result.confirmed.map(({ id }) => id)).toEqual([100, 101])
  })

  it('falls back to a COMMENT once on a rejected event, retrying it as a transient post', async () => {
    const { io, mocks } = pull()
    mocks.postReview
      .mockRejectedValueOnce(new ReviewRejectedError('no', { cause: 'x' }))
      .mockRejectedValueOnce(new Error('HTTP 502: Bad Gateway'))
    const request = { ...first(), event: 'REQUEST_CHANGES' as const }
    const result = await postReviews(io, [request], retrier().value)
    expect(mocks.postReview.mock.calls.map(([review]) => review.event)).toEqual([
      'REQUEST_CHANGES',
      'COMMENT',
      'COMMENT',
    ])
    expect(result).toMatchObject({ event: 'COMMENT', downgraded: 'rejected' })
  })
})
