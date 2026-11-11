import { describe, expect, it, vi } from 'vitest'

import {
  abortReview,
  claimReview,
  completeReview,
  COMPLETE_LABEL,
  createGhLabelIo,
  IN_PROGRESS_LABEL,
  REQUESTED_LABEL,
  type LabelIo,
} from './labels.mts'

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
    await io.remove('final approval')
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
    const io = fakeIo([REQUESTED_LABEL, COMPLETE_LABEL, 'final approval', 'other'])
    const outcome = await claimReview(io)
    expect(outcome).toEqual({
      claimed: true,
      added: [IN_PROGRESS_LABEL],
      removed: [REQUESTED_LABEL, COMPLETE_LABEL, 'final approval'],
    })
    expect(io.calls[0]).toBe(`add:${IN_PROGRESS_LABEL}`)
    expect(io.calls.slice(1)).toHaveLength(3)
    expect([...io.set].sort()).toEqual([IN_PROGRESS_LABEL, 'other'].sort())
  })

  it('does not re-add in-progress or remove absent labels', async () => {
    const io = fakeIo([REQUESTED_LABEL, IN_PROGRESS_LABEL])
    const outcome = await claimReview(io)
    expect(outcome).toEqual({ claimed: true, added: [], removed: [REQUESTED_LABEL] })
    expect(io.calls).toEqual([`remove:${REQUESTED_LABEL}`])
  })

  it('refuses without the requested label', async () => {
    const io = fakeIo(['x'])
    expect(await claimReview(io)).toEqual({
      claimed: false,
      reason: 'no final-review:requested label',
      labels: ['x'],
    })
    expect(io.calls).toEqual([])
  })

  it('reports an in-progress review', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await claimReview(io)).toMatchObject({ claimed: false, reason: 'already in progress' })
  })

  it('claims anyway with force', async () => {
    const io = fakeIo([])
    expect(await claimReview(io, { force: true })).toEqual({
      claimed: true,
      added: [IN_PROGRESS_LABEL],
      removed: [],
    })
  })
})

describe('completeReview', () => {
  it('adds complete then removes in-progress', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await completeReview(io)).toEqual({
      added: [COMPLETE_LABEL],
      removed: [IN_PROGRESS_LABEL],
    })
    expect(io.calls).toEqual([`add:${COMPLETE_LABEL}`, `remove:${IN_PROGRESS_LABEL}`])
  })
})

describe('abortReview', () => {
  it('drops in-progress without requeue', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await abortReview(io)).toEqual({ added: [], removed: [IN_PROGRESS_LABEL] })
    expect(io.calls).toEqual([`remove:${IN_PROGRESS_LABEL}`])
  })

  it('requeues by adding requested before removing in-progress', async () => {
    const io = fakeIo([IN_PROGRESS_LABEL])
    expect(await abortReview(io, { requeue: true })).toEqual({
      added: [REQUESTED_LABEL],
      removed: [IN_PROGRESS_LABEL],
    })
    expect(io.calls).toEqual([`add:${REQUESTED_LABEL}`, `remove:${IN_PROGRESS_LABEL}`])
  })
})
