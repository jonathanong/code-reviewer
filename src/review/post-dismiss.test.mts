import { describe, expect, it, vi } from 'vitest'

import { fakeIo, input, SHA, type MockIo } from './post-fake-io.mts'
import { postFinalReview } from './post.mts'

describe('postFinalReview earlier reviews that still count', () => {
  const MARK = `<!-- final-review sha=${'a'.repeat(40)} verdict=Request-Changes effort=low -->`
  const CR = 'CHANGES_REQUESTED' as const
  const OK = 'APPROVED' as const
  const standing = (extra: Partial<MockIo> = {}) =>
    fakeIo({
      standingReviews: vi.fn(async () => [
        { id: 11, author: 'bot', body: `${MARK}\n\nOld`, state: CR },
        { id: 12, author: 'eve', body: `${MARK}\n\nForged`, state: CR },
        { id: 13, author: 'bot', body: 'unmarked', state: CR },
        { id: 21, author: 'bot', body: `${MARK}\n\nOld approval`, state: OK },
        { id: 22, author: 'eve', body: `${MARK}\n\nForged approval`, state: OK },
        { id: 23, author: 'bot', body: 'unmarked approval', state: OK },
      ]),
      ...extra,
    })

  it('dismisses only its own marked request for changes and approval after a COMMENT, once posted', async () => {
    const io = standing()
    const outcome = await postFinalReview(io, input('high'), SHA)
    expect(outcome).toMatchObject({ event: 'COMMENT', dismissed: [11, 21] })
    expect(io.dismissReview.mock.calls.map(([id]) => id)).toEqual([11, 21])
    expect(io.dismissReview).toHaveBeenCalledWith(
      21,
      expect.stringContaining('https://example.test/review/'),
    )
    expect(io.postReview.mock.invocationCallOrder[0]).toBeLessThan(
      io.dismissReview.mock.invocationCallOrder[0] as number,
    )
  })

  it("dismisses an earlier own approval at any head after a COMMENT, never another author's", async () => {
    const io = fakeIo({
      standingReviews: vi.fn(async () => [
        { id: 31, author: 'bot', body: `${MARK}\n\nApproved`, state: OK },
        { id: 32, author: 'eve', body: `${MARK}\n\nForged`, state: OK },
      ]),
    })
    const outcome = await postFinalReview(io, input('high'), SHA)
    expect(outcome.dismissed).toEqual([31])
    expect(io.dismissReview).not.toHaveBeenCalledWith(32, expect.anything())
  })

  it('dismisses nothing when the post fails, so the old block is never cleared without a new review', async () => {
    const io = standing({
      postReview: vi.fn(async () => {
        throw new Error('HTTP 401: Bad credentials')
      }),
    })
    await expect(postFinalReview(io, input('high'), SHA)).rejects.toThrow('HTTP 401')
    expect(io.standingReviews).not.toHaveBeenCalled()
    expect(io.dismissReview).not.toHaveBeenCalled()
  })

  it('dismisses nothing when the new review cannot be confirmed, and says so', async () => {
    const io = standing({ trustedAuthors: vi.fn(async () => new Set<string>()) })
    const outcome = await postFinalReview(io, input('high'), SHA)
    expect(outcome).toMatchObject({ confirmed: false, dismissed: [] })
    expect(io.dismissReview).not.toHaveBeenCalled()
    expect(outcome.warnings).toContain(
      'An earlier request for changes or approval was not dismissed because the new review was not confirmed.',
    )
  })

  it('leaves it alone for APPROVE and REQUEST_CHANGES, and when the verdict still requests changes', async () => {
    for (const severity of ['low', 'blocking'] as const) {
      const io = standing()
      await expect(postFinalReview(io, input(severity), SHA)).resolves.toMatchObject({
        dismissed: [],
      })
      expect(io.standingReviews).not.toHaveBeenCalled()
    }
    const unknown = standing({ trustedAuthors: vi.fn(async () => new Set<string>()) })
    const outcome = await postFinalReview(unknown, input('blocking'), SHA)
    expect(outcome).toMatchObject({ downgraded: 'identity-unknown', dismissed: [] })
    expect(unknown.standingReviews).not.toHaveBeenCalled()
  })

  it('does not fail the post when a dismissal fails, and names the state left standing', async () => {
    const io = standing({
      dismissReview: vi.fn(async () => {
        throw new Error('403')
      }),
    })
    const outcome = await postFinalReview(io, input('high'), SHA)
    expect(outcome.dismissed).toEqual([])
    expect(outcome.warnings).toEqual([
      expect.stringContaining('Review 11 still requests changes'),
      expect.stringContaining('Review 21 still approves'),
    ])
    expect(io.postReview).toHaveBeenCalledOnce()
  })

  it('says what it would dismiss on a dry run, and dismisses nothing', async () => {
    const io = standing()
    const outcome = await postFinalReview(io, input('high'), SHA, { dryRun: true })
    expect(outcome).toMatchObject({ dismissed: [], wouldDismiss: [11, 21] })
    expect(io.dismissReview).not.toHaveBeenCalled()
    expect(io.postReview).not.toHaveBeenCalled()
    const approve = await postFinalReview(standing(), input('low'), SHA, { dryRun: true })
    expect(approve.wouldDismiss).toEqual([])
  })
})
