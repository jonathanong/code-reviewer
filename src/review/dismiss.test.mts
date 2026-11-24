import { describe, expect, it, vi } from 'vitest'

import { dismissRequests, staleRequests } from './dismiss.mts'

const MARK = `<!-- final-review sha=${'a'.repeat(40)} verdict=Request-Changes effort=low -->`
const PART = `<!-- final-review-part sha=${'a'.repeat(40)} part=2 -->`

const requested = (
  id: number,
  author: string | null,
  body: string,
  state: 'CHANGES_REQUESTED' | 'APPROVED' = 'CHANGES_REQUESTED',
) => ({ id, author, body, state })
const BOTH = ['CHANGES_REQUESTED', 'APPROVED'] as const

function io(reviews: ReturnType<typeof requested>[], trusted: string[] = ['bot']) {
  return {
    standingReviews: vi.fn(async () => reviews),
    trustedAuthors: vi.fn(async () => new Set(trusted)),
  }
}

describe('staleRequests', () => {
  it("picks only the reviewer's own marked reviews that request changes", async () => {
    const found = await staleRequests(
      io([
        requested(1, 'bot', `${MARK}\n\nBody`),
        requested(2, 'Bot[bot]', `${PART}\n\nPart`),
        requested(3, 'bot', 'A human-style review from the same account, no marker'),
        requested(4, 'eve', `${MARK}\n\nForged marker`),
        requested(5, null, MARK),
      ]),
      ['CHANGES_REQUESTED'],
    )
    expect(found).toEqual({
      reviews: [
        { id: 1, state: 'CHANGES_REQUESTED' },
        { id: 2, state: 'CHANGES_REQUESTED' },
      ],
      warnings: [],
    })
  })

  it('picks only the states it is asked for', async () => {
    const reviews = [
      requested(1, 'bot', MARK, 'CHANGES_REQUESTED'),
      requested(2, 'bot', MARK, 'APPROVED'),
      requested(3, 'eve', MARK, 'APPROVED'),
    ]
    const ids = async (states: readonly ('CHANGES_REQUESTED' | 'APPROVED')[]) =>
      (await staleRequests(io(reviews), states)).reviews.map(({ id }) => id)
    await expect(ids(['CHANGES_REQUESTED'])).resolves.toEqual([1])
    await expect(ids(['APPROVED'])).resolves.toEqual([2])
    await expect(ids(BOTH)).resolves.toEqual([1, 2])
  })

  it('does not look up identity when nothing requests changes', async () => {
    const fake = io([requested(3, 'bot', 'no marker')])
    await expect(staleRequests(fake, BOTH)).resolves.toEqual({ reviews: [], warnings: [] })
    expect(fake.trustedAuthors).not.toHaveBeenCalled()
  })

  it('names the reviews it leaves standing when the identity is unknown', async () => {
    const { reviews, warnings } = await staleRequests(
      io([requested(7, 'bot', MARK), requested(9, 'bot', MARK, 'APPROVED')], []),
      BOTH,
    )
    expect(reviews).toEqual([])
    expect(warnings).toEqual([
      expect.stringContaining('Review 7 still requests changes'),
      expect.stringContaining('Review 9 still approves'),
    ])
    const failing = {
      ...io([requested(8, 'bot', MARK)]),
      trustedAuthors: vi.fn(async (): Promise<Set<string>> => {
        throw new Error('boom')
      }),
    }
    expect((await staleRequests(failing, BOTH)).warnings).toEqual([
      expect.stringContaining('Review 8'),
    ])
  })

  it('warns, and does not fail, when the lookup fails', async () => {
    const failing = {
      ...io([]),
      standingReviews: vi.fn(async (): Promise<ReturnType<typeof requested>[]> => {
        throw new Error('rate limited')
      }),
    }
    const { reviews, warnings } = await staleRequests(failing, BOTH)
    expect(reviews).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('rate limited')])
  })
})

const cr = (id: number) => ({ id, state: 'CHANGES_REQUESTED' as const })
const ok = (id: number) => ({ id, state: 'APPROVED' as const })

describe('dismissRequests', () => {
  it('dismisses each review with one line that points at the new one', async () => {
    const dismissReview = vi.fn(async (_id: number, _message: string) => undefined)
    await expect(
      dismissRequests({ dismissReview }, [cr(1), ok(2)], 'https://x.test/r'),
    ).resolves.toEqual({
      dismissed: [1, 2],
      warnings: [],
    })
    expect(dismissReview).toHaveBeenCalledWith(1, 'Superseded by a newer review: https://x.test/r')
    await dismissRequests({ dismissReview }, [cr(3)], undefined)
    expect(dismissReview).toHaveBeenLastCalledWith(3, 'Superseded by a newer review.')
  })

  it('keeps going and names the review it could not dismiss', async () => {
    const dismissReview = vi
      .fn<(id: number, message: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValueOnce(undefined)
    const result = await dismissRequests({ dismissReview }, [ok(1), cr(2)], undefined)
    expect(result.dismissed).toEqual([2])
    expect(result.warnings).toEqual([expect.stringContaining('Review 1 still approves')])
    const plain = vi.fn(async (_id: number, _message: string): Promise<void> => {
      throw 'plain text failure'
    })
    const text = await dismissRequests({ dismissReview: plain }, [cr(5)], undefined)
    expect(text.warnings).toEqual([expect.stringContaining('plain text failure')])
  })
})
