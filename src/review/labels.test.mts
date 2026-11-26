import { describe, expect, it, vi } from 'vitest'

import {
  abortReview,
  claimReview,
  completeReview,
  createGhLabelIo,
  skipReview,
  type LabelIo,
} from './labels.mts'
import { heldHeadFrom, parseTimelineRows } from './held-head.mts'
import { DEFAULT_LABELS } from './settings.mts'

const {
  requested: REQUESTED_LABEL,
  processing: IN_PROGRESS_LABEL,
  completed: COMPLETE_LABEL,
  held: HELD_LABEL,
  approval: APPROVAL_LABEL,
} = DEFAULT_LABELS

type Fake = LabelIo & { set: Set<string>; calls: string[] }

function fakeIo(initial: string[], held?: string | Error): Fake {
  const set = new Set(initial)
  const calls: string[] = []
  return {
    set,
    calls,
    async labels() {
      return [...set]
    },
    async add(names) {
      calls.push(`add:${names.join(',')}`)
      for (const name of names) set.add(name)
    },
    async remove(name) {
      calls.push(`remove:${name}`)
      set.delete(name)
    },
    async heldHead() {
      if (held instanceof Error) throw held
      return held
    },
  }
}

describe('heldHeadFrom', () => {
  it('names the head before the last held label', () => {
    const text = 'committed\tAAA\nlabeled\tfinal-review:held\nhead_ref_force_pushed\tbbb\n'
    expect(heldHeadFrom(parseTimelineRows(text), HELD_LABEL)).toBe('aaa')
  })

  it('has no head once the hold was removed, or before any commit, or for another label', () => {
    expect(
      heldHeadFrom(
        parseTimelineRows(
          'committed\taaa\nlabeled\tfinal-review:held\nunlabeled\tfinal-review:held',
        ),
        HELD_LABEL,
      ),
    ).toBeUndefined()
    expect(
      heldHeadFrom(parseTimelineRows('labeled\tfinal-review:held'), HELD_LABEL),
    ).toBeUndefined()
    expect(
      heldHeadFrom(parseTimelineRows('committed\taaa\nlabeled\tother'), HELD_LABEL),
    ).toBeUndefined()
    expect(parseTimelineRows('labeled')).toEqual([{ event: 'labeled', value: '' }])
  })
})

describe('createGhLabelIo', () => {
  it('reads the held head from the timeline', async () => {
    const run = vi.fn(
      async (_args: readonly string[]) => 'committed\tAbc\nlabeled\tfinal-review:held\n',
    )
    const io = createGhLabelIo({ repo: 'o/r', pr: 7 }, run)
    expect(await io.heldHead(HELD_LABEL)).toBe('abc')
    expect(run.mock.calls[0]?.[0]).toContain('repos/o/r/issues/7/timeline?per_page=100')
  })

  const target = { repo: 'o/r', pr: 7 }

  it('parses, trims, and drops blank label lines', async () => {
    const run = vi.fn(async (_args: readonly string[]) => ' a \n\nb b\n  \n')
    const io = createGhLabelIo(target, run)
    expect(await io.labels()).toEqual(['a', 'b b'])
    expect(run).toHaveBeenCalledWith([
      'api',
      '--paginate',
      'repos/o/r/issues/7/labels?per_page=100',
      '-q',
      '.[].name',
    ])
  })

  it('adds several labels with repeated -f flags', async () => {
    const run = vi.fn(async (_args: readonly string[]) => '')
    await createGhLabelIo(target, run).add(['x', 'y'])
    expect(run).toHaveBeenCalledWith([
      'api',
      '--method',
      'POST',
      'repos/o/r/issues/7/labels',
      '-f',
      'labels[]=x',
      '-f',
      'labels[]=y',
    ])
  })

  it('url-encodes the removed label name', async () => {
    const run = vi.fn(async (_args: readonly string[]) => '')
    const io = createGhLabelIo(target, run)
    await io.remove('final-review:in-progress')
    await io.remove(APPROVAL_LABEL)
    expect(run).toHaveBeenNthCalledWith(1, [
      'api',
      '--method',
      'DELETE',
      'repos/o/r/issues/7/labels/final-review%3Ain-progress',
      '--silent',
    ])
    expect(run).toHaveBeenNthCalledWith(2, [
      'api',
      '--method',
      'DELETE',
      'repos/o/r/issues/7/labels/final%20approval',
      '--silent',
    ])
  })

  it('rejects an invalid target', () => {
    expect(() => createGhLabelIo({ repo: 'bad', pr: 1 }, vi.fn())).toThrow('--repo')
  })
})

describe('claimReview', () => {
  it('swaps requested for in-progress, adding before removing', async () => {
    const io = fakeIo([REQUESTED_LABEL, COMPLETE_LABEL, APPROVAL_LABEL, 'other'])
    const outcome = await claimReview(io, DEFAULT_LABELS)
    expect(outcome).toEqual({
      claimed: true,
      added: [IN_PROGRESS_LABEL],
      removed: [REQUESTED_LABEL, COMPLETE_LABEL, APPROVAL_LABEL],
    })
    expect(io.calls[0]).toBe(`add:${IN_PROGRESS_LABEL}`)
    expect(io.calls.slice(1)).toHaveLength(3)
    expect([...io.set].sort()).toEqual([IN_PROGRESS_LABEL, 'other'].sort())
  })

  it('does not re-add in-progress or remove absent labels', async () => {
    const io = fakeIo([REQUESTED_LABEL, IN_PROGRESS_LABEL])
    const outcome = await claimReview(io, DEFAULT_LABELS)
    expect(outcome).toEqual({ claimed: true, added: [], removed: [REQUESTED_LABEL] })
    expect(io.calls).toEqual([`remove:${REQUESTED_LABEL}`])
  })

  it('refuses without the requested label', async () => {
    const io = fakeIo(['x'])
    expect(await claimReview(io, DEFAULT_LABELS)).toEqual({
      claimed: false,
      reason: 'no final-review:requested label',
      labels: ['x'],
    })
    expect(io.calls).toEqual([])
  })

  it('reports an in-progress review', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await claimReview(io, DEFAULT_LABELS)).toMatchObject({
      claimed: false,
      reason: 'already in progress',
    })
  })

  it('claims anyway with force', async () => {
    const io = fakeIo([])
    expect(await claimReview(io, DEFAULT_LABELS, { force: true })).toEqual({
      claimed: true,
      added: [IN_PROGRESS_LABEL],
      removed: [],
    })
  })

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

  it('claims a held review with force and clears the hold', async () => {
    const io = fakeIo([HELD_LABEL])
    await claimReview(io, DEFAULT_LABELS, { force: true })
    expect([...io.set]).toEqual([IN_PROGRESS_LABEL])
  })

  it('backs off without touching labels when a request reappears after the swap', async () => {
    const io = fakeIo([REQUESTED_LABEL])
    const original = io.labels.bind(io)
    let reads = 0
    io.labels = async () => {
      reads += 1
      if (reads === 3) io.set.add(REQUESTED_LABEL)
      return original()
    }
    const outcome = await claimReview(io, DEFAULT_LABELS)
    expect(outcome).toMatchObject({ claimed: false, reason: 'claim lost' })
    expect(io.set.has(IN_PROGRESS_LABEL)).toBe(true)
    expect(io.calls.filter((call) => call.startsWith('remove:'))).toEqual([
      `remove:${REQUESTED_LABEL}`,
    ])
  })

  it('backs off when another machine completed or held it after the swap', async () => {
    for (const taken of [COMPLETE_LABEL, HELD_LABEL]) {
      const io = fakeIo([REQUESTED_LABEL])
      const original = io.labels.bind(io)
      let reads = 0
      io.labels = async () => {
        reads += 1
        if (reads === 3) io.set.add(taken)
        return original()
      }
      expect(await claimReview(io, DEFAULT_LABELS)).toMatchObject({ reason: 'claim lost' })
    }
  })

  it('keeps a hold another machine set between our read and our swap', async () => {
    const io = fakeIo([REQUESTED_LABEL])
    const original = io.labels.bind(io)
    let reads = 0
    io.labels = async () => {
      reads += 1
      if (reads === 2) io.set.add(HELD_LABEL)
      return original()
    }
    expect(await claimReview(io, DEFAULT_LABELS)).toMatchObject({ reason: 'claim lost' })
    expect(io.set.has(HELD_LABEL)).toBe(true)
  })

  it('clears a hold on a forced claim', async () => {
    const io = fakeIo([HELD_LABEL])
    expect(await claimReview(io, DEFAULT_LABELS, { force: true })).toMatchObject({ claimed: true })
    expect(io.set.has(HELD_LABEL)).toBe(false)
  })

  it('undoes its claim and rethrows when a post-swap read fails', async () => {
    const failure = new Error('rate limited')
    for (const failing of ['labels', 'reviewedSince']) {
      const io = fakeIo([REQUESTED_LABEL])
      const original = io.labels.bind(io)
      let reads = 0
      io.labels = async () => {
        reads += 1
        if (failing === 'labels' && reads === 3) throw failure
        return original()
      }
      const reviewedSince = async () => {
        throw failure
      }
      await expect(claimReview(io, DEFAULT_LABELS, { reviewedSince })).rejects.toBe(failure)
      expect([...io.set]).toEqual([REQUESTED_LABEL])
    }
  })

  it('leaves an in-progress label it did not add when the undo runs', async () => {
    const failure = new Error('post-swap')
    const io = fakeIo([REQUESTED_LABEL, IN_PROGRESS_LABEL])
    const original = io.labels.bind(io)
    let reads = 0
    io.labels = async () => {
      reads += 1
      if (reads === 3) throw failure
      return original()
    }
    await expect(claimReview(io, DEFAULT_LABELS)).rejects.toBe(failure)
    expect([...io.set].sort()).toEqual([IN_PROGRESS_LABEL, REQUESTED_LABEL].sort())
  })

  it('still rethrows the original failure when the undo itself fails', async () => {
    const failure = new Error('post-swap')
    const io = fakeIo([REQUESTED_LABEL])
    const original = io.labels.bind(io)
    let reads = 0
    io.labels = async () => {
      reads += 1
      if (reads === 3) throw failure
      return original()
    }
    const add = io.add.bind(io)
    let adds = 0
    io.add = async (names) => {
      adds += 1
      if (adds > 1) throw new Error('undo failed')
      await add(names)
    }
    await expect(claimReview(io, DEFAULT_LABELS)).rejects.toBe(failure)
  })

  it('backs off when our in-progress label is gone after the swap', async () => {
    const io = fakeIo([REQUESTED_LABEL])
    const original = io.labels.bind(io)
    let reads = 0
    io.labels = async () => {
      reads += 1
      if (reads === 3) io.set.delete(IN_PROGRESS_LABEL)
      return original()
    }
    expect(await claimReview(io, DEFAULT_LABELS)).toMatchObject({ reason: 'claim lost' })
  })

  it('backs off when a review of this head was posted since the claim began', async () => {
    const io = fakeIo([REQUESTED_LABEL])
    const reviewedSince = vi.fn(async () => true)
    expect(await claimReview(io, DEFAULT_LABELS, { reviewedSince })).toMatchObject({
      claimed: false,
      reason: 'claim lost',
    })
    expect(reviewedSince).toHaveBeenCalledOnce()
  })

  it('keeps the claim when no review appeared, and skips the recheck with force', async () => {
    const reviewedSince = vi.fn(async () => false)
    expect(
      await claimReview(fakeIo([REQUESTED_LABEL]), DEFAULT_LABELS, { reviewedSince }),
    ).toMatchObject({ claimed: true })
    const forced = vi.fn(async () => true)
    expect(
      await claimReview(fakeIo([]), DEFAULT_LABELS, { force: true, reviewedSince: forced }),
    ).toMatchObject({ claimed: true })
    expect(forced).not.toHaveBeenCalled()
  })
})

describe('completeReview', () => {
  it('clears a hold when a person posts the held review', async () => {
    const io = fakeIo([HELD_LABEL])
    expect(await completeReview(io, DEFAULT_LABELS)).toEqual({
      added: [COMPLETE_LABEL],
      removed: [HELD_LABEL],
    })
  })

  it('adds complete then removes in-progress', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await completeReview(io, DEFAULT_LABELS)).toEqual({
      added: [COMPLETE_LABEL],
      removed: [IN_PROGRESS_LABEL],
    })
    expect(io.calls).toEqual([`add:${COMPLETE_LABEL}`, `remove:${IN_PROGRESS_LABEL}`])
  })

  it('clears the request a held review put back', async () => {
    const io = fakeIo([REQUESTED_LABEL])
    expect(await completeReview(io, DEFAULT_LABELS)).toEqual({
      added: [COMPLETE_LABEL],
      removed: [REQUESTED_LABEL],
    })
    expect([...io.set]).toEqual([COMPLETE_LABEL])
  })
})

describe('abortReview', () => {
  it('drops in-progress without requeue', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await abortReview(io, DEFAULT_LABELS)).toEqual({
      added: [],
      removed: [IN_PROGRESS_LABEL],
    })
    expect(io.calls).toEqual([`remove:${IN_PROGRESS_LABEL}`])
  })

  it('requeues by adding requested before removing in-progress', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await abortReview(io, DEFAULT_LABELS, { requeue: true })).toEqual({
      added: [REQUESTED_LABEL],
      removed: [IN_PROGRESS_LABEL],
    })
    expect(io.calls).toEqual([`add:${REQUESTED_LABEL}`, `remove:${IN_PROGRESS_LABEL}`])
  })

  it('holds by adding held, never requested, before removing in-progress', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await abortReview(io, DEFAULT_LABELS, { hold: true })).toEqual({
      added: [HELD_LABEL],
      removed: [IN_PROGRESS_LABEL],
    })
    expect(io.calls).toEqual([`add:${HELD_LABEL}`, `remove:${IN_PROGRESS_LABEL}`])
  })

  it('clears a standing hold when aborting, with or without a requeue', async () => {
    const dropped = fakeIo([HELD_LABEL])
    await abortReview(dropped, DEFAULT_LABELS)
    expect([...dropped.set]).toEqual([])
    const requeued = fakeIo([IN_PROGRESS_LABEL, HELD_LABEL])
    await abortReview(requeued, DEFAULT_LABELS, { requeue: true })
    expect([...requeued.set]).toEqual([REQUESTED_LABEL])
  })
})

describe('claimReview when the head is already reviewed', () => {
  it('answers the request with complete and keeps final approval', async () => {
    const io = fakeIo([REQUESTED_LABEL, COMPLETE_LABEL, APPROVAL_LABEL])
    await expect(claimReview(io, DEFAULT_LABELS, { headReviewed: true })).resolves.toMatchObject({
      claimed: false,
      reason: 'head already reviewed',
    })
    expect([...io.set].sort()).toEqual([APPROVAL_LABEL, COMPLETE_LABEL])
  })

  it('adds nothing when no request is pending', async () => {
    const io = fakeIo([COMPLETE_LABEL, APPROVAL_LABEL])
    await claimReview(io, DEFAULT_LABELS, { headReviewed: true })
    expect(io.calls).toEqual([])
  })

  it('reviews again with force', async () => {
    const io = fakeIo([COMPLETE_LABEL, APPROVAL_LABEL])
    await expect(
      claimReview(io, DEFAULT_LABELS, { force: true, headReviewed: true }),
    ).resolves.toMatchObject({
      claimed: true,
    })
    expect([...io.set]).toEqual([IN_PROGRESS_LABEL])
  })
})

describe('custom label names', () => {
  const names = {
    requested: 'review me',
    processing: 'reviewing',
    completed: 'reviewed',
    held: 'on hold',
    approval: 'lgtm',
  }

  it('claims, completes, and aborts with the configured names only', async () => {
    const io = fakeIo(['review me', 'reviewed', 'lgtm', REQUESTED_LABEL])
    await claimReview(io, names)
    expect([...io.set].sort()).toEqual([REQUESTED_LABEL, 'reviewing'].sort())
    await completeReview(io, names)
    expect([...io.set].sort()).toEqual([REQUESTED_LABEL, 'reviewed'].sort())
    const aborted = fakeIo(['reviewing'])
    await abortReview(aborted, names, { requeue: true })
    expect([...aborted.set]).toEqual(['review me'])
  })

  it('does not treat the default request label as a request', async () => {
    await expect(claimReview(fakeIo([REQUESTED_LABEL]), names)).resolves.toMatchObject({
      claimed: false,
      reason: 'no review me label',
    })
  })
})

describe('skipReview', () => {
  it('swaps processing and requested for completed and leaves the approval label alone', async () => {
    const io = fakeIo([REQUESTED_LABEL, IN_PROGRESS_LABEL, APPROVAL_LABEL, 'other'])
    await expect(skipReview(io, DEFAULT_LABELS)).resolves.toEqual({
      added: [COMPLETE_LABEL],
      removed: [IN_PROGRESS_LABEL, REQUESTED_LABEL],
    })
    expect([...io.set].sort()).toEqual([APPROVAL_LABEL, COMPLETE_LABEL, 'other'])
  })

  it('clears a hold', async () => {
    const io = fakeIo([HELD_LABEL])
    await skipReview(io, DEFAULT_LABELS)
    expect([...io.set]).toEqual([COMPLETE_LABEL])
  })
})
