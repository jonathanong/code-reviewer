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

  it('keeps the order of the entries', () => {
    const io = memoryTracker([row({ state: 'reviewed' })])
    expect(markHeld([entry({ pr: 9 }), entry()], io).map((each) => each.pr)).toEqual([9, 7])
  })
})
