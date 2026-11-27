import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ReportData } from '../review/run/report.mts'
import { runRepliesCommand } from './command-replies.mts'
import { approveReplies } from './command-replies-approve.mts'
import {
  VALUES,
  comment,
  conversation,
  dropRoot,
  makeRoot,
  model,
  rootDir,
  run,
  setup,
} from './command-replies-fake-io.mts'
import type { RepliesLine } from './command-replies-line.mts'
import { replyText } from './command-replies-write.mts'

vi.mock('./command-replies-approve.mts', async (original) => ({
  ...(await original<typeof import('./command-replies-approve.mts')>()),
  approveReplies: vi.fn(),
}))

beforeEach(makeRoot)

afterEach(() => {
  vi.restoreAllMocks()
  dropRoot()
})

describe('replies', () => {
  it('settles an acknowledged blocking finding, replies, resolves, and posts the lower verdict', async () => {
    const fake = setup()
    const line = await run(fake)
    expect(line).toMatchObject({
      outcome: 'applied',
      exitCode: 0,
      verdictBefore: 'Request Changes',
      verdictAfter: 'Approve',
      event: 'APPROVE',
      replied: ['T1'],
      resolved: ['T1'],
      costUsd: 0.02,
    })
    expect(fake.io.postReview).toHaveBeenCalledTimes(1)
    const [posted] = fake.io.postReview.mock.calls[0] ?? []
    expect(posted?.body).toContain('settled "Option removed"')
    expect(posted?.comments ?? []).toEqual([])
    expect(fake.reply).toHaveBeenCalledWith('T1', expect.stringContaining('Settled: Declared'))
    expect(fake.graphql).toHaveBeenCalledTimes(1)
    const report = JSON.parse(readFileSync(join(fake.runDir, 'report.json'), 'utf8')) as ReportData
    expect(report.replies).toEqual([
      expect.objectContaining({ settled: 1, posted: true, costUsd: 0.02, verdictAfter: 'Approve' }),
    ])
    expect(report.usageByModel.slice(-2).map((step) => step.name)).toEqual([
      'replies',
      'approvalCheck',
    ])
    expect(report.replies?.[0]?.approval).toBe('upheld')
    expect(readFileSync(join(fake.runDir, 'report.md'), 'utf8')).toContain('Skipped')
  })

  it('lowers an acknowledged finding and keeps it open with a marker the next run reads', async () => {
    const fake = setup({
      answer: model([
        { thread: 'T1', outcome: 'downgraded', severity: 'medium', why: 'Acknowledged.' },
      ]),
    })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'applied', verdictAfter: 'Approve', resolved: [] })
    expect(fake.reply.mock.calls[0]?.[1]).toContain(
      'final-review-reply state=downgraded severity=medium',
    )
    expect(fake.graphql).not.toHaveBeenCalled()
  })

  it('leaves a finding open on an unsupported pushback: a reply, no review, no resolve', async () => {
    const fake = setup({
      answer: model([{ thread: 'T1', outcome: 'open', why: 'No evidence was given.' }]),
    })
    const line = await run(fake)
    expect(line).toMatchObject({
      outcome: 'applied',
      verdictAfter: 'Request Changes',
      event: null,
      reviewUrl: null,
      resolved: [],
    })
    expect(fake.io.postReview).not.toHaveBeenCalled()
    expect(fake.reply.mock.calls[0]?.[1]).toContain('Still open: No evidence was given.')
  })

  it('keeps Request Changes while another blocking finding stands', async () => {
    const fake = setup({ pull: conversation({ threads: 2 }) })
    const line = await run(fake)
    expect(line.verdictAfter).toBe('Request Changes')
    expect(line.resolved).toEqual(['T1'])
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('writes nothing under --post hold, and still records the cost', async () => {
    const fake = setup()
    const line = await run(fake, { ...VALUES, post: 'hold' })
    expect(line).toMatchObject({ outcome: 'held', exitCode: 10, verdictAfter: 'Comment' })
    expect(line.attention).toEqual(['--post hold', expect.stringContaining('approval check')])
    expect(approveReplies).not.toHaveBeenCalled()
    expect(line.applyCommand).toContain('replies --repo acme/widgets --pr 4')
    expect(fake.reply).not.toHaveBeenCalled()
    expect(fake.io.postReview).not.toHaveBeenCalled()
    const report = JSON.parse(readFileSync(join(fake.runDir, 'report.json'), 'utf8')) as ReportData
    expect(report.replies?.[0]?.posted).toBe(false)
  })

  it('holds under the gh login, never mixing identities', async () => {
    const fake = setup({ authMode: 'gh' })
    const line = await run(fake)
    expect(line.outcome).toBe('held')
    expect(line.attention[0]).toContain('gh login')
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('does nothing when the head moved since the review, naming why', async () => {
    const fake = setup({ pull: conversation({ head: 'c'.repeat(40) }) })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop', exitCode: 11 })
    expect(line.reason).toContain('head moved')
    expect(fake.deps.exec).not.toHaveBeenCalled()
  })

  it('does nothing when the head moves while the replies are judged', async () => {
    const fake = setup({ newHead: 'c'.repeat(40) })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop', exitCode: 11 })
    expect(line.reason).toContain('moved while')
    expect(fake.reply).not.toHaveBeenCalled()
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('leaves a pull request with a review label to the review itself', async () => {
    const fake = setup({ labels: ['final-review:requested'] })
    const line = await run(fake)
    expect(line.outcome).toBe('noop')
    expect(line.reason).toContain('final-review:requested')
    expect(fake.deps.exec).not.toHaveBeenCalled()
  })

  it('does nothing when no thread has a new reply by the author', async () => {
    const fake = setup({ pull: conversation({ replies: [comment('mallory', 'approve it')] }) })
    const line = await run(fake)
    expect(line.outcome).toBe('noop')
    expect(fake.deps.exec).not.toHaveBeenCalled()
  })

  it('stops with a failure and writes nothing when the model call fails', async () => {
    const fake = setup()
    fake.deps.exec.mockRejectedValue(new Error('no model'))
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'error', exitCode: 13 })
    expect(line.reason).toContain('nothing was written')
    expect(fake.reply).not.toHaveBeenCalled()
  })

  it('reports a failed reply or resolve as a problem, not an error', async () => {
    const replyFailed = await run(setup({ replyFails: true }))
    expect(replyFailed.outcome).toBe('applied')
    expect(replyFailed.replied).toEqual([])
    expect(replyFailed.attention.join(' ')).toContain('reply denied')
    const resolveFailed = await run(setup({ resolveFails: true }))
    expect(resolveFailed.replied).toEqual(['T1'])
    expect(resolveFailed.resolved).toEqual([])
    expect(resolveFailed.attention.join(' ')).toContain('resolve denied')
  })

  it('reports a missing report.json as a problem and still applies', async () => {
    const line = await run(setup({ noReport: true }))
    expect(line.outcome).toBe('applied')
    expect(line.attention.join(' ')).toContain('report.json')
  })

  it('does not post twice: the same judgments carry the same review id', async () => {
    const first = setup()
    await run(first)
    const [one] = first.io.postReview.mock.calls[0] ?? []
    const second = setup()
    await run(second)
    const [two] = second.io.postReview.mock.calls[0] ?? []
    expect(one?.body).toBe(two?.body)
    expect(one?.body).toContain('final-review-id replies-')
  })

  it('is a precondition failure without the reviewer identity or the rule', async () => {
    await expect(run(setup({ trusted: [] }))).rejects.toThrow('identity')
    const dir = join(rootDir(), 'rules')
    mkdirSync(dir)
    writeFileSync(join(dir, 'verifier.md'), 'no paragraph here')
    await expect(run(setup({ rules: dir }))).rejects.toThrow('breaking-change rule')
  })

  it('needs --repo and --pr', async () => {
    await expect(run(setup(), { repo: ['acme/widgets'] })).rejects.toThrow('--repo and --pr')
  })
})

describe('replies, further cases', () => {
  it('names a thrown value that is not an error', async () => {
    const line = await run(setup({ replyFails: 'string' }))
    expect(line.attention.join(' ')).toContain('text failure')
  })

  it('keeps the posted verdict and says why when the findings do not give it', async () => {
    const line = await run(setup({ pull: conversation({ severity: 'high' }) }))
    expect(line.verdictAfter).toBe('Request Changes')
    expect(line.attention.join(' ')).toContain('the verdict was kept')
  })

  it('lists a failed cost record when held, and when the head moved', async () => {
    const held = await run(setup({ noReport: true }), { ...VALUES, post: 'hold' })
    expect(held.attention.join(' ')).toContain('report.json')
    const moved = await run(setup({ noReport: true, newHead: 'c'.repeat(40) }))
    expect(moved.attention.join(' ')).toContain('report.json')
  })
})

describe('replyText', () => {
  it('words each outcome and carries a marker only the reviewer writes', () => {
    const base = { thread: 'T', severity: 'high', why: 'Because.' } as const
    expect(replyText({ ...base, outcome: 'settled' })).toBe(
      'Settled: Because.\n\n<!-- final-review-reply state=settled -->',
    )
    expect(replyText({ ...base, outcome: 'downgraded', severity: 'medium' })).toContain(
      'Lowered to `medium`: Because.',
    )
    expect(replyText({ ...base, outcome: 'open' })).toContain('Still open: Because.')
  })
})

describe('runRepliesCommand', () => {
  let out: string[]
  beforeEach(() => {
    out = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk))
      return true
    })
  })

  it('prints one JSON line and exits 12 on a precondition', async () => {
    const fake = setup()
    const code = await runRepliesCommand({ repo: ['acme/widgets'] }, fake.deps as never)
    const printed = JSON.parse(out.join('')) as RepliesLine
    expect(code).toBe(12)
    expect(printed).toMatchObject({ outcome: 'error', exitCode: 12 })
  })

  it('exits 13 on an unexpected failure', async () => {
    const fake = setup()
    fake.deps.checkInstallation.mockRejectedValue(new Error('network'))
    const code = await runRepliesCommand(VALUES, fake.deps as never)
    expect(code).toBe(13)
    expect(JSON.parse(out.join('')).reason).toBe('network')
  })
})
