import { describe, expect, it, vi } from 'vitest'

import {
  abortReview,
  claimReview,
  completeReview,
  createGhLabelIo,
  skipReview,
  type LabelIo,
} from './labels.mts'
import { DEFAULT_LABELS } from './settings.mts'

const {
  requested: REQUESTED_LABEL,
  processing: IN_PROGRESS_LABEL,
  completed: COMPLETE_LABEL,
  approval: APPROVAL_LABEL,
} = DEFAULT_LABELS

type Fake = LabelIo & { set: Set<string>; calls: string[] }

function fakeIo(initial: string[]): Fake {
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
  }
}

describe('createGhLabelIo', () => {
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
})

describe('completeReview', () => {
  it('adds complete then removes in-progress', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await completeReview(io, DEFAULT_LABELS)).toEqual({
      added: [COMPLETE_LABEL],
      removed: [IN_PROGRESS_LABEL],
    })
    expect(io.calls).toEqual([`add:${COMPLETE_LABEL}`, `remove:${IN_PROGRESS_LABEL}`])
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
})
