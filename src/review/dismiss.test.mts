import { describe, expect, it, vi } from 'vitest'

import { dismissRequests, staleRequests } from './dismiss.mts'

const MARK = `<!-- final-review sha=${'a'.repeat(40)} verdict=Request-Changes effort=low -->`
const PART = `<!-- final-review-part sha=${'a'.repeat(40)} part=2 -->`

const requested = (id: number, author: string | null, body: string) => ({ id, author, body })

function io(reviews: ReturnType<typeof requested>[], trusted: string[] = ['bot']) {
  return {
    changesRequested: vi.fn(async () => reviews),
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
    )
    expect(found).toEqual({ ids: [1, 2], warnings: [] })
  })

  it('does not look up identity when nothing requests changes', async () => {
    const fake = io([requested(3, 'bot', 'no marker')])
    await expect(staleRequests(fake)).resolves.toEqual({ ids: [], warnings: [] })
    expect(fake.trustedAuthors).not.toHaveBeenCalled()
  })

  it('names the reviews it leaves standing when the identity is unknown', async () => {
    const { ids, warnings } = await staleRequests(io([requested(7, 'bot', MARK)], []))
    expect(ids).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('Review 7 still requests changes')])
    const failing = {
      ...io([requested(8, 'bot', MARK)]),
      trustedAuthors: vi.fn(async (): Promise<Set<string>> => {
        throw new Error('boom')
      }),
    }
    expect((await staleRequests(failing)).warnings).toEqual([expect.stringContaining('Review 8')])
  })

  it('warns, and does not fail, when the lookup fails', async () => {
    const failing = {
      ...io([]),
      changesRequested: vi.fn(async (): Promise<ReturnType<typeof requested>[]> => {
        throw new Error('rate limited')
      }),
    }
    const { ids, warnings } = await staleRequests(failing)
    expect(ids).toEqual([])
    expect(warnings).toEqual([expect.stringContaining('rate limited')])
  })
})

describe('dismissRequests', () => {
  it('dismisses each review with one line that points at the new one', async () => {
    const dismissReview = vi.fn(async (_id: number, _message: string) => undefined)
    await expect(dismissRequests({ dismissReview }, [1, 2], 'https://x.test/r')).resolves.toEqual({
      dismissed: [1, 2],
      warnings: [],
    })
    expect(dismissReview).toHaveBeenCalledWith(1, 'Superseded by a newer review: https://x.test/r')
    await dismissRequests({ dismissReview }, [3], undefined)
    expect(dismissReview).toHaveBeenLastCalledWith(3, 'Superseded by a newer review.')
  })

  it('keeps going and names the review it could not dismiss', async () => {
    const dismissReview = vi
      .fn<(id: number, message: string) => Promise<void>>()
      .mockRejectedValueOnce(new Error('403'))
      .mockResolvedValueOnce(undefined)
    const result = await dismissRequests({ dismissReview }, [1, 2], undefined)
    expect(result.dismissed).toEqual([2])
    expect(result.warnings).toEqual([expect.stringContaining('Review 1 still requests changes')])
    const plain = vi.fn(async (_id: number, _message: string): Promise<void> => {
      throw 'plain text failure'
    })
    const text = await dismissRequests({ dismissReview: plain }, [5], undefined)
    expect(text.warnings).toEqual([expect.stringContaining('plain text failure')])
  })
})
