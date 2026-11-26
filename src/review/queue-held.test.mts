import { describe, expect, it } from 'vitest'

import { EARLIER_HEAD, RUN_DIR, memoryTracker, row, savedRun } from './earlier-fake-io.mts'
import type { QueueEntry } from './queue.mts'
import { markHeld } from './queue-held.mts'

function entry(rest: Partial<QueueEntry> = {}): QueueEntry {
  return {
    repo: 'o/r',
    pr: 7,
    headSha: EARLIER_HEAD,
    state: 'requested',
    isDraft: false,
    updatedAt: 't',
    url: 'u',
    ...rest,
  }
}

describe('markHeld', () => {
  it('marks a requested entry held, with the run directory, when an unposted review covers its head', () => {
    const io = memoryTracker([row({ state: 'reviewed', repo: 'O/R' })])
    const stacked = entry({ stack: { root: 7, position: 1, size: 2 } })
    expect(markHeld([stacked], io)).toEqual([{ ...stacked, state: 'held', runDir: RUN_DIR }])
  })

  it('leaves a requested entry whose head moved past the reviewed one', () => {
    const io = memoryTracker([row({ state: 'reviewed' })])
    const moved = entry({ headSha: 'a'.repeat(40) })
    expect(markHeld([moved], io)).toEqual([moved])
  })

  it('leaves a requested entry whose run directory lost its review.json', () => {
    const io = memoryTracker([row({ state: 'reviewed' })], {
      [RUN_DIR]: savedRun({ 'review.json': undefined }),
    })
    expect(markHeld([entry()], io)).toEqual([entry()])
  })

  it('leaves an entry whose review.json cannot be read as requested and still lists the others', () => {
    const base = memoryTracker(
      [
        row({ state: 'reviewed', pr: 7 }),
        row({ state: 'reviewed', pr: 8, runDir: '/state/runs/o/r/8-bbbbbbbbbbbb' }),
      ],
      {
        [RUN_DIR]: savedRun(),
        '/state/runs/o/r/8-bbbbbbbbbbbb': savedRun(),
      },
    )
    const io = {
      ...base,
      read: (path: string) => {
        if (path.startsWith(RUN_DIR) && path.endsWith('review.json')) throw new Error('EACCES')
        return base.read(path)
      },
    }
    const result = markHeld([entry(), entry({ pr: 8 })], io)
    expect(result.map((each) => each.state)).toEqual(['requested', 'held'])
  })

  it('leaves a requested entry whose row was posted or failed', () => {
    for (const state of ['posted', 'failed'] as const) {
      expect(markHeld([entry()], memoryTracker([row({ state })]))).toEqual([entry()])
    }
  })

  it('leaves an in-progress entry in progress even with an unposted review of its head', () => {
    const io = memoryTracker([row({ state: 'reviewed' })])
    const running = entry({ state: 'in-progress' })
    expect(markHeld([running], io)).toEqual([running])
  })

  it("names the run directory of a held-labelled entry this machine holds, and leaves another machine's hold without one", () => {
    const io = memoryTracker([row({ state: 'reviewed' })])
    expect(markHeld([entry({ state: 'held' })], io)).toEqual([
      entry({ state: 'held', runDir: RUN_DIR }),
    ])
    const elsewhere = entry({ state: 'held', headSha: 'a'.repeat(40) })
    expect(markHeld([elsewhere], io)).toEqual([elsewhere])
  })

  it('keeps the order of the entries', () => {
    const io = memoryTracker([row({ state: 'reviewed' })])
    expect(markHeld([entry({ pr: 9 }), entry()], io).map((each) => each.pr)).toEqual([9, 7])
  })
})
