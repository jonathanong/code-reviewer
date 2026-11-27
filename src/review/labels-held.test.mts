import { describe, expect, it, vi } from 'vitest'

import { heldFrom, parseTimelineRows } from './held-head.mts'
import { claimReview, createGhLabelIo } from './labels.mts'
import { fakeIo } from './labels-fake-io.mts'
import { DEFAULT_LABELS } from './settings.mts'

const {
  requested: REQUESTED_LABEL,
  processing: IN_PROGRESS_LABEL,
  held: HELD_LABEL,
} = DEFAULT_LABELS

describe('heldHeadFrom', () => {
  it('names the head before the last held label', () => {
    const text = 'committed\tAAA\nlabeled\tfinal-review:held\nhead_ref_force_pushed\tbbb\n'
    expect(heldFrom(parseTimelineRows(text), HELD_LABEL)).toEqual({ head: 'aaa', placements: 1 })
  })

  it('has no head once the hold was removed, or before any commit, or for another label', () => {
    expect(
      heldFrom(
        parseTimelineRows(
          'committed\taaa\nlabeled\tfinal-review:held\nunlabeled\tfinal-review:held',
        ),
        HELD_LABEL,
      ),
    ).toEqual({ head: undefined, placements: 1 })
    expect(
      heldFrom(parseTimelineRows('labeled\tfinal-review:held'), HELD_LABEL).head,
    ).toBeUndefined()
    expect(heldFrom(parseTimelineRows('committed\taaa\nlabeled\tother'), HELD_LABEL)).toEqual({
      head: undefined,
      placements: 0,
    })
    expect(parseTimelineRows('labeled')).toEqual([{ event: 'labeled', value: '' }])
  })
})

describe('createGhLabelIo held head', () => {
  it('reads the held head from the timeline', async () => {
    const run = vi.fn(
      async (_args: readonly string[]) => 'committed\tAbc\nlabeled\tfinal-review:held\n',
    )
    const io = createGhLabelIo({ repo: 'o/r', pr: 7 }, run)
    expect(await io.heldHead(HELD_LABEL)).toEqual({ head: 'abc', placements: 1 })
    expect(run.mock.calls[0]?.[0]).toContain('repos/o/r/issues/7/timeline?per_page=100')
  })

  it('reads the label name, not a commit id, from a labeled event', async () => {
    const run = vi.fn(async (_args: readonly string[]) => '')
    await createGhLabelIo({ repo: 'o/r', pr: 7 }, run).heldHead(HELD_LABEL)
    const filter = String(run.mock.calls[0]?.[0].at(-1))
    expect(filter).toContain(
      'if .event == "labeled" or .event == "unlabeled" then (.label.name // "") else (.sha // .commit_id // "") end',
    )
    // A labeled event that carries a commit_id still reads as the label, so the hold is found.
    const row = 'labeled\tfinal-review:held'
    expect(heldFrom(parseTimelineRows(`committed\tabc\n${row}`), HELD_LABEL).head).toBe('abc')
  })
})

describe('claimReview with a hold', () => {
  it('declines a review held on the current head, even when a person re-requested it', async () => {
    const io = fakeIo([HELD_LABEL, REQUESTED_LABEL], 'abc')
    expect(await claimReview(io, DEFAULT_LABELS, { headSha: 'ABC' })).toMatchObject({
      claimed: false,
      reason: 'held for a person',
    })
    expect(io.calls).toEqual([])
  })

  it('declines a hold whose head cannot be determined, and says so', async () => {
    for (const io of [
      fakeIo([HELD_LABEL, REQUESTED_LABEL]),
      fakeIo([HELD_LABEL, REQUESTED_LABEL], new Error('api down')),
    ]) {
      expect(await claimReview(io, DEFAULT_LABELS, { headSha: 'abc' })).toMatchObject({
        claimed: false,
        reason: 'held for a person (the held head could not be determined)',
      })
      expect(io.calls).toEqual([])
    }
    const noHead = fakeIo([HELD_LABEL, REQUESTED_LABEL], 'abc')
    expect(await claimReview(noHead, DEFAULT_LABELS)).toMatchObject({ claimed: false })
  })

  it('claims a new head pushed after the hold and clears the stale held label', async () => {
    const io = fakeIo([HELD_LABEL, REQUESTED_LABEL], 'old')
    expect(await claimReview(io, DEFAULT_LABELS, { headSha: 'new' })).toMatchObject({
      claimed: true,
    })
    expect([...io.set]).toEqual([IN_PROGRESS_LABEL])
  })

  it('declines before changing labels when the head moved since it was pinned', async () => {
    const io = fakeIo([HELD_LABEL, REQUESTED_LABEL], 'old')
    expect(
      await claimReview(io, DEFAULT_LABELS, { headSha: 'OLD', liveHeadSha: 'new' }),
    ).toMatchObject({ claimed: false, reason: 'head moved' })
    expect(io.calls).toEqual([])
    const same = fakeIo([REQUESTED_LABEL])
    expect(
      await claimReview(same, DEFAULT_LABELS, { headSha: 'ABC', liveHeadSha: 'abc' }),
    ).toMatchObject({ claimed: true })
  })

  it('puts back a hold re-placed after the stale lookup and backs off', async () => {
    const io = fakeIo([HELD_LABEL, REQUESTED_LABEL])
    let looks = 0
    io.heldHead = async () => {
      looks += 1
      return looks === 1 ? { head: 'old', placements: 1 } : { head: 'new', placements: 2 }
    }
    const outcome = await claimReview(io, DEFAULT_LABELS, { headSha: 'new' })
    expect(outcome).toMatchObject({ claimed: false, reason: 'claim lost' })
    expect([...io.set]).toEqual([HELD_LABEL])
    expect(io.calls.at(-2)).toBe(`add:${HELD_LABEL}`)
    expect(io.calls.at(-1)).toBe(`remove:${IN_PROGRESS_LABEL}`)
  })

  it('keeps the claim when the timeline shows no new hold, or cannot be read again', async () => {
    for (const second of [{ head: undefined, placements: 1 }, new Error('api down')]) {
      const io = fakeIo([HELD_LABEL, REQUESTED_LABEL])
      let looks = 0
      io.heldHead = async () => {
        looks += 1
        if (looks === 1) return { head: 'old', placements: 1 }
        if (second instanceof Error) throw second
        return second
      }
      expect(await claimReview(io, DEFAULT_LABELS, { headSha: 'new' })).toMatchObject({
        claimed: true,
      })
      expect([...io.set]).toEqual([IN_PROGRESS_LABEL])
    }
  })
})
