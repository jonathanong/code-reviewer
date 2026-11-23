import { describe, expect, it, vi } from 'vitest'

import { createGhAnswerIo, postAnswers, type AnswerIo } from './answers-post.mts'
import type { Answer } from './answers.mts'
import type { PrConversation, ReviewThread, ThreadComment } from './context-query.mts'

const OWN = new Set(['reviewer-app'])
const answer = (thread: string, extra: Partial<Answer> = {}): Answer => ({
  thread,
  body: 'No lock needed.',
  at: 'src/a.ts:3',
  ...extra,
})
const comment = (login: string): ThreadComment => ({
  author: { login },
  body: 'x',
  createdAt: '',
  pullRequestReview: null,
})
const thread = (id: string, extra: Partial<ReviewThread> = {}): ReviewThread => ({
  id,
  isResolved: false,
  isOutdated: false,
  path: 'a.ts',
  line: 1,
  comments: { totalCount: 1, nodes: [comment('codex[bot]')] },
  ...extra,
})
const io = (threads: ReviewThread[]) => {
  const reply = vi.fn(async (_thread: string, _body: string) => {})
  const fake: AnswerIo = {
    conversation: async () => ({ reviewThreads: { nodes: threads } }) as unknown as PrConversation,
    reply,
  }
  return { fake, reply }
}

describe('postAnswers', () => {
  it('replies in each open thread with the rendered answer and resolves nothing', async () => {
    const { fake, reply } = io([thread('T1'), thread('T2')])
    const out = await postAnswers(fake, OWN, [answer('T1'), answer('T2')])
    expect(out).toEqual({ replied: ['T1', 'T2'], skipped: [], failed: [] })
    expect(reply).toHaveBeenCalledWith('T1', 'No lock needed.\n\n`src/a.ts:3`')
  })

  it('does nothing for no answers, and no reply without an identity', async () => {
    const { fake, reply } = io([thread('T1')])
    expect(await postAnswers(fake, OWN, [])).toEqual({ replied: [], skipped: [], failed: [] })
    const out = await postAnswers(fake, new Set(), [answer('T1')])
    expect(out.skipped).toEqual([{ thread: 'T1', why: 'own identity is unknown' }])
    expect(reply).not.toHaveBeenCalled()
  })

  it.each([
    ['a thread no longer on the pull request', [], 'not among those read'],
    ['a resolved thread', [thread('T1', { isResolved: true })], 'resolved'],
    [
      'a thread this reviewer already replied in',
      [
        thread('T1', {
          comments: { totalCount: 2, nodes: [comment('codex[bot]'), comment('Reviewer-App[bot]')] },
        }),
      ],
      'already spoke',
    ],
    [
      'a thread longer than what was read',
      [thread('T1', { comments: { totalCount: 50, nodes: [comment('codex[bot]')] } })],
      'too long',
    ],
  ])('skips %s', async (_name, threads, why) => {
    const { fake, reply } = io(threads)
    const out = await postAnswers(fake, new Set(['reviewer-app']), [answer('T1')])
    expect(out.skipped).toEqual([{ thread: 'T1', why: expect.stringContaining(why) }])
    expect(reply).not.toHaveBeenCalled()
  })

  it('skips a reply whose final text mentions someone', async () => {
    const { fake, reply } = io([thread('T1')])
    const out = await postAnswers(fake, OWN, [
      { thread: 'T1', body: 'No.', rule: { skill: 'a:b', quote: 'say hi to @bob please ok' } },
    ])
    expect(out.skipped[0]?.why).toContain('mentions')
    expect(reply).not.toHaveBeenCalled()
  })

  it('reports a failed reply and goes on to the next', async () => {
    const { fake, reply } = io([thread('T1'), thread('T2')])
    reply.mockRejectedValueOnce(new Error('boom'))
    const out = await postAnswers(fake, OWN, [answer('T1'), answer('T2')])
    expect(out).toEqual({ replied: ['T2'], skipped: [], failed: [{ thread: 'T1', why: 'boom' }] })
  })

  it('reports every answer failed when the thread cannot be read again', async () => {
    const reply = vi.fn()
    const out = await postAnswers(
      {
        conversation: async () => {
          throw new Error('offline')
        },
        reply,
      },
      OWN,
      [answer('T1'), answer('T2')],
    )
    expect(out.failed.map((entry) => entry.why)).toEqual(['offline', 'offline'])
    expect(reply).not.toHaveBeenCalled()
  })

  it('names a failure that is not an error by its text', async () => {
    const { fake, reply } = io([thread('T1')])
    reply.mockRejectedValueOnce('nope')
    expect((await postAnswers(fake, OWN, [answer('T1')])).failed[0]?.why).toBe('nope')
  })
})

describe('createGhAnswerIo', () => {
  it('sends the body as a raw field, so it is never read as a file', async () => {
    const run = vi.fn(async (_args: readonly string[]) => '')
    await createGhAnswerIo({ repo: 'acme/widgets', pr: 4 }, run).reply('T1', '@file body')
    const args = run.mock.calls[0]?.[0] as string[]
    expect(args).toContain('body=@file body')
    expect(args[args.indexOf('body=@file body') - 1]).toBe('-f')
    expect(args).not.toContain('-F')
    expect(args.join(' ')).toContain('addPullRequestReviewThreadReply')
    expect(args.join(' ')).not.toContain('resolveReviewThread')
  })

  it('reads the conversation of its pull request', async () => {
    const run = vi.fn(async (_args: readonly string[]) =>
      JSON.stringify({ data: { repository: { pullRequest: { reviewThreads: { nodes: [] } } } } }),
    )
    const pull = await createGhAnswerIo({ repo: 'acme/widgets', pr: 4 }, run).conversation()
    expect(pull.reviewThreads.nodes).toEqual([])
    expect(run.mock.calls[0]?.[0]).toContain('pr=4')
  })
})
