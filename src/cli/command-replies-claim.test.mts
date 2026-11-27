import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReportData } from '../review/run/report.mts'
import { approveReplies } from './command-replies-approve.mts'
import {
  PASSED,
  VALUES,
  dropRoot,
  makeRoot,
  model,
  run,
  setup,
} from './command-replies-fake-io.mts'

vi.mock('./command-replies-approve.mts', async (original) => ({
  ...(await original<typeof import('./command-replies-approve.mts')>()),
  approveReplies: vi.fn(),
}))

beforeEach(makeRoot)

afterEach(() => {
  vi.restoreAllMocks()
  dropRoot()
})

const PROCESSING = 'final-review:in-progress'
const COMPLETE = 'final-review:complete'

describe('replies claim the pull request', () => {
  it('holds the in-progress label while it works and gives the completion back after', async () => {
    const fake = setup({ labels: [COMPLETE] })
    const during: string[][] = []
    fake.deps.exec.mockImplementation(async () => {
      during.push([...fake.labels])
      return model([{ thread: 'T1', outcome: 'settled', why: 'Declared.' }])
    })
    await run(fake)
    expect(during).toEqual([[PROCESSING]])
    expect(fake.labels).toEqual([COMPLETE])
  })

  it('refuses a claim another run took between the first read and the claim', async () => {
    const fake = setup()
    fake.labelIo.labels.mockResolvedValueOnce([]).mockResolvedValue([PROCESSING])
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop', exitCode: 11 })
    expect(line.reason).toContain(PROCESSING)
    expect(fake.deps.exec).not.toHaveBeenCalled()
    expect(fake.reply).not.toHaveBeenCalled()
    expect(fake.io.postReview).not.toHaveBeenCalled()
    expect(fake.labelIo.remove).not.toHaveBeenCalled()
  })

  it('releases the claim when the model call fails, and when a write throws', async () => {
    const failed = setup({ labels: [COMPLETE] })
    failed.deps.exec.mockRejectedValue(new Error('no model'))
    expect((await run(failed)).outcome).toBe('error')
    expect(failed.labels).toEqual([COMPLETE])
    const threw = setup({ labels: [COMPLETE], postFails: true })
    await expect(run(threw)).rejects.toThrow('GitHub is down')
    expect(threw.labels).toEqual([COMPLETE])
    expect(threw.reply).not.toHaveBeenCalled()
  })

  it('says so when the claim could not be given back', async () => {
    // An open reply posts no review, so the release is what takes in-progress off.
    const fake = setup({
      labels: [COMPLETE],
      answer: model([{ thread: 'T1', outcome: 'open', why: 'No evidence.' }]),
    })
    fake.labelIo.remove.mockImplementation(async (name) => {
      if (name === PROCESSING) throw new Error('labels unavailable')
      fake.labels.splice(fake.labels.indexOf(name), 1)
    })
    const line = await run(fake)
    expect(line.attention.join(' ')).toContain('could not release the claim: labels unavailable')
  })

  it('still throws the failure when the claim cannot be given back after it', async () => {
    const fake = setup({ labels: [COMPLETE], postFails: true })
    fake.labelIo.remove.mockImplementation(async (name) => {
      if (name === PROCESSING) throw new Error('labels unavailable')
      fake.labels.splice(fake.labels.indexOf(name), 1)
    })
    await expect(run(fake)).rejects.toThrow('GitHub is down')
  })

  it('costs nothing known when no step reports a cost', async () => {
    const fake = setup({
      answer: JSON.stringify({
        type: 'result',
        num_turns: 1,
        structured_output: {
          judgments: [{ thread: 'T1', outcome: 'open', why: 'No evidence.' }],
        },
      }),
    })
    expect((await run(fake)).costUsd).toBeNull()
  })

  it('takes no claim when it only holds', async () => {
    const fake = setup({ labels: [COMPLETE] })
    await run(fake, { ...VALUES, post: 'hold' })
    expect(fake.labelIo.add).not.toHaveBeenCalled()
    expect(fake.labels).toEqual([COMPLETE])
  })

  it('writes nothing when another review by this reviewer lands while the replies are judged', async () => {
    const fake = setup({ landedAt: 3 })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop', exitCode: 11 })
    expect(line.reason).toContain('newer review')
    expect(fake.reply).not.toHaveBeenCalled()
    expect(fake.io.postReview).not.toHaveBeenCalled()
    expect(fake.graphql).not.toHaveBeenCalled()
    expect(fake.labels).toEqual([COMPLETE])
  })

  it('loses the claim when a review landed before it was taken', async () => {
    const fake = setup({ landedAt: 2 })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop' })
    expect(line.reason).toContain('claim lost')
    expect(fake.deps.exec).not.toHaveBeenCalled()
  })
})

describe('replies and the approval check', () => {
  it('runs the check before an Approve, and posts the Approve when it passes', async () => {
    const fake = setup()
    const line = await run(fake)
    expect(approveReplies).toHaveBeenCalledTimes(1)
    expect(line).toMatchObject({ verdictAfter: 'Approve', event: 'APPROVE' })
  })

  it('posts a Comment, with the reason, when the check does not uphold the approval', async () => {
    const reason = 'the approval check did not uphold the approval: it missed the migration'
    const fake = setup({
      approval: {
        approval: { passed: false, reason: `${reason}, so this is a comment, not an approval.` },
        outcome: 'not upheld',
        usage: null,
        ran: undefined,
        notes: [reason],
      },
    })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'applied', verdictAfter: 'Comment', event: 'COMMENT' })
    expect(line.attention).toContain(reason)
    const [posted] = fake.io.postReview.mock.calls[0] ?? []
    expect(posted?.body).toContain('not an approval')
    const report = JSON.parse(readFileSync(join(fake.runDir, 'report.json'), 'utf8')) as ReportData
    expect(report.replies?.[0]?.approval).toBe('not upheld')
  })

  it('adds the check to the cost', async () => {
    const usage = { costUsd: 0.5, byModel: {} } as never
    const fake = setup({ approval: { ...PASSED, usage } })
    expect((await run(fake)).costUsd).toBeCloseTo(0.52)
  })

  it('does not run the check when the verdict stays or only drops to a Comment', async () => {
    await run(setup({ answer: model([{ thread: 'T1', outcome: 'open', why: 'No evidence.' }]) }))
    const lowered = await run(
      setup({
        answer: model([{ thread: 'T1', outcome: 'downgraded', severity: 'high', why: 'Partly.' }]),
      }),
    )
    expect(lowered.verdictAfter).toBe('Comment')
    expect(approveReplies).not.toHaveBeenCalled()
  })
})
