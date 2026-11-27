import { describe, expect, it } from 'vitest'

import { claimReplies, releaseReplies } from './label-claim-steps.mts'
import { fakeIo } from './labels-fake-io.mts'
import { DEFAULT_LABELS } from './settings.mts'

const { requested, processing, completed, held, approval } = DEFAULT_LABELS

describe('claimReplies', () => {
  it('takes in-progress, drops the completion, and leaves the approval label alone', async () => {
    const io = fakeIo([completed, approval])
    const outcome = await claimReplies(io, DEFAULT_LABELS, {})
    expect(outcome).toMatchObject({ claimed: true, added: [processing], removed: [completed] })
    expect([...io.set].sort()).toEqual([approval, processing].sort())
  })

  it.each([[requested], [processing], [held]])(
    'declines a pull request that carries %s, and changes nothing',
    async (label) => {
      const io = fakeIo([completed, label])
      const outcome = await claimReplies(io, DEFAULT_LABELS, {})
      expect(outcome).toMatchObject({ claimed: false })
      expect(outcome.claimed === false && outcome.reason).toContain(label)
      expect(io.calls).toEqual([])
    },
  )

  it('loses the claim when a request lands between the read and the swap, and leaves the labels', async () => {
    const io = fakeIo([completed])
    const labels = io.labels
    let reads = 0
    // Reads: the busy check, the swap's own, then the re-read; a request lands before the last.
    io.labels = async () => {
      reads += 1
      if (reads === 3) io.set.add(requested)
      return labels()
    }
    const outcome = await claimReplies(io, DEFAULT_LABELS, {})
    expect(outcome).toMatchObject({ claimed: false, reason: 'claim lost' })
    expect(io.set.has(processing)).toBe(true)
    expect(io.set.has(requested)).toBe(true)
  })

  it('loses the claim when a review of this reviewer landed since the plan was read', async () => {
    const io = fakeIo([completed])
    const outcome = await claimReplies(io, DEFAULT_LABELS, { reviewedSince: async () => true })
    expect(outcome).toMatchObject({ claimed: false, reason: 'claim lost' })
  })

  it('gives the claim back and rethrows when the re-check fails', async () => {
    const io = fakeIo([completed])
    await expect(
      claimReplies(io, DEFAULT_LABELS, {
        reviewedSince: async () => {
          throw new Error('GitHub is down')
        },
      }),
    ).rejects.toThrow('GitHub is down')
    expect([...io.set]).toEqual([completed])
  })

  it('still rethrows the re-check failure when giving the claim back fails too', async () => {
    const io = fakeIo([completed])
    const labels = io.labels
    let failing = false
    io.labels = async () => {
      if (failing) throw new Error('labels unavailable')
      return labels()
    }
    await expect(
      claimReplies(io, DEFAULT_LABELS, {
        reviewedSince: async () => {
          failing = true
          throw new Error('GitHub is down')
        },
      }),
    ).rejects.toThrow('GitHub is down')
  })
})

describe('releaseReplies', () => {
  it('puts the completion back and drops in-progress', async () => {
    const io = fakeIo([processing])
    await releaseReplies(io, DEFAULT_LABELS)
    expect([...io.set]).toEqual([completed])
  })

  it.each([[requested], [held]])(
    'keeps a %s placed meanwhile and leaves the completion off, so the next review claims it',
    async (label) => {
      const io = fakeIo([processing, label])
      await releaseReplies(io, DEFAULT_LABELS)
      expect([...io.set]).toEqual([label])
    },
  )
})
