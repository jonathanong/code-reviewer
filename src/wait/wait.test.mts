import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { line } from '../cli/command-replies-line.mts'
import {
  HEAD,
  REQUESTED,
  commentEvent,
  labelEvent,
  marker,
  repo,
  result,
  setup,
  type Setup,
} from './wait-fake-io.mts'
import type { HarnessEvent } from './harness.mts'
import { wait } from './wait.mts'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'wait-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const timedOut = (cursor = 'end') => result([], { timedOut: true, cursor })

function start(options: Omit<Setup, 'stateDir'>) {
  const fake = setup({ ...options, stateDir: dir })
  return { ...fake, go: () => wait(fake.waitOptions, fake.deps, fake.run) }
}

describe('wait: request label events', () => {
  it('returns one request per pull request at its current head and keeps the cursor', async () => {
    const fake = start({
      labels: [REQUESTED],
      calls: [result([labelEvent(4), labelEvent(4, { headSha: 'b'.repeat(40) }), labelEvent(5)])],
    })
    const out = await fake.go()
    expect(out).toMatchObject({
      outcome: 'work',
      exitCode: 0,
      requests: [
        { repo, pr: 4, headSha: HEAD },
        { repo, pr: 5, headSha: HEAD },
      ],
      cursor: 'c3',
    })
    expect(readFileSync(join(dir, 'wait-test.cursor'), 'utf8')).toBe('c3\n')
    expect(fake.replies).not.toHaveBeenCalled()
  })

  it('asks hook-harness for the stored cursor and the time left', async () => {
    writeFileSync(join(dir, 'wait-test.cursor'), 'saved\n')
    const fake = start({ calls: [timedOut()] })
    await fake.go()
    expect(fake.harness).toHaveBeenCalledWith({
      owners: ['acme'],
      labels: [REQUESTED],
      ignoreSenders: ['coderabbitai[bot]'],
      timeoutSeconds: 100,
      after: 'saved',
    })
  })

  const labelCases: Array<{
    name: string
    event: Partial<HarnessEvent>
    rest: Omit<Setup, 'calls' | 'stateDir'>
  }> = [
    { name: 'this reviewer sent', event: { sender: { login: 'reviewer[bot]' } }, rest: {} },
    { name: 'an issue', event: { issue: { number: 4 } }, rest: {} },
    { name: 'a closed pull request', event: {}, rest: { open: false } },
    { name: 'a pull request with no request label any more', event: {}, rest: { labels: [] } },
    {
      name: 'a head already reviewed',
      event: {},
      rest: { labels: [REQUESTED], reviews: [marker('Approve')] },
    },
    {
      name: 'a head already in progress',
      event: {},
      rest: { labels: [REQUESTED, 'final-review:in-progress'] },
    },
  ]

  it.each(labelCases)(
    'drops a label event for $name and goes on to the timeout',
    async ({ event, rest }) => {
      const fake = start({
        labels: [REQUESTED],
        ...rest,
        calls: [result([labelEvent(4, event)]), timedOut()],
      })
      const out = await fake.go()
      expect(out).toMatchObject({ outcome: 'timeout', exitCode: 11, timedOut: true, requests: [] })
      expect(Object.values(out.dropped)).toEqual([1])
      expect(fake.harness).toHaveBeenCalledTimes(2)
    },
  )

  it('still returns the request when its check fails, and says so', async () => {
    const fake = start({ labels: [REQUESTED], calls: [result([labelEvent(4)])] })
    fake.deps.createIo.mockImplementation(() => {
      throw new Error('GitHub is down')
    })
    const out = await fake.go()
    expect(out.requests).toEqual([{ repo, pr: 4, headSha: HEAD }])
    expect(out.problems).toEqual([`${repo}#4: could not check the request: GitHub is down`])
  })
})

describe('wait: review comment events', () => {
  const mine = { labels: [], reviews: [marker('Request-Changes')] }

  it('counts applied and no-op replies runs and keeps waiting', async () => {
    const fake = start({
      ...mine,
      calls: [result([commentEvent(4), commentEvent(5)]), timedOut()],
    })
    fake.replies.mockResolvedValueOnce(line({ exitCode: 0, outcome: 'applied' }))
    const out = await fake.go()
    expect(out).toMatchObject({
      outcome: 'timeout',
      attention: [],
      handled: { applied: 1, noop: 1 },
    })
    expect(fake.replies).toHaveBeenCalledWith({ repo, pr: 4 })
  })

  it.each([
    [
      'a held result',
      line({
        exitCode: 10,
        outcome: 'held',
        reason: 'needs a person',
        applyCommand: 'code-reviewer replies',
      }),
    ],
    ['a failed result', line({ exitCode: 13, outcome: 'error', reason: 'denied' })],
    ['a configuration problem', line({ exitCode: 12, outcome: 'error', reason: 'bad config' })],
  ])('returns %s as attention', async (_name, answer) => {
    const fake = start({ ...mine, calls: [result([commentEvent(4)])] })
    fake.replies.mockResolvedValueOnce(answer)
    const out = await fake.go()
    expect(out).toMatchObject({
      outcome: 'work',
      exitCode: 0,
      attention: [{ repo, pr: 4, exitCode: answer.exitCode, reason: answer.reason }],
      handled: { applied: 0, noop: 0 },
    })
  })

  it('returns a replies run that throws as a failure', async () => {
    const fake = start({ ...mine, calls: [result([commentEvent(4)])] })
    fake.replies.mockRejectedValueOnce(new Error('boom'))
    const out = await fake.go()
    expect(out.attention).toMatchObject([{ pr: 4, exitCode: 13, outcome: 'error', reason: 'boom' }])
  })

  const noPayload: HarnessEvent = {
    repo,
    prs: [4],
    event: 'pull_request_review_comment',
    action: 'created',
    sender: { login: 'dev' },
  }
  const busy = (label: string) => ({
    name: `a pull request carrying ${label}`,
    event: commentEvent(4),
    rest: { labels: [label], reviews: [marker('Request-Changes')] },
    why: 'request, in-progress or held label',
  })
  const commentCases: Array<{
    name: string
    event: HarnessEvent
    rest: Omit<Setup, 'calls' | 'stateDir'>
    why: string
  }> = [
    {
      name: 'a sender in the ignore list',
      event: commentEvent(4, 100, 'coderabbitai[bot]'),
      rest: mine,
      why: 'ignored sender',
    },
    {
      name: 'this reviewer as sender',
      event: commentEvent(4, 100, 'reviewer[bot]'),
      rest: mine,
      why: 'ignored sender',
    },
    {
      name: 'a comment that starts a thread',
      event: commentEvent(4, null),
      rest: mine,
      why: 'not a reply',
    },
    { name: 'a comment without a payload', event: noPayload, rest: mine, why: 'no payload' },
    {
      name: 'an event with no pull request',
      event: commentEvent(4, 100, 'dev', { prs: [] }),
      rest: mine,
      why: 'no pull request',
    },
    {
      name: 'a thread another account started',
      event: commentEvent(4, 100),
      rest: { ...mine, authors: { 100: 'coderabbitai[bot]' } },
      why: 'not a thread this reviewer started',
    },
    {
      name: 'a closed pull request',
      event: commentEvent(4),
      rest: { ...mine, open: false },
      why: 'closed',
    },
    {
      name: 'a pull request this reviewer has not reviewed',
      event: commentEvent(4),
      rest: { labels: [], reviews: [] },
      why: 'no review by this reviewer',
    },
    busy('final-review:requested'),
    busy('final-review:in-progress'),
    busy('final-review:held'),
  ]

  it.each(commentCases)('drops $name without running replies', async ({ event, rest, why }) => {
    const fake = start({ ...rest, calls: [result([event]), timedOut()] })
    const out = await fake.go()
    expect(out).toMatchObject({ outcome: 'timeout', attention: [] })
    expect(out.dropped[why]).toBe(1)
    expect(fake.replies).not.toHaveBeenCalled()
  })

  it('reads each thread root once per pull request and runs replies once', async () => {
    const fake = start({
      ...mine,
      calls: [result([commentEvent(4), commentEvent(4), commentEvent(4)]), timedOut()],
    })
    await fake.go()
    expect(fake.commentAuthor).toHaveBeenCalledTimes(1)
    expect(fake.replies).toHaveBeenCalledTimes(1)
  })

  it('treats one thread of this reviewer among several as enough', async () => {
    const fake = start({
      ...mine,
      authors: { 100: 'coderabbitai[bot]' },
      calls: [result([commentEvent(4, 100), commentEvent(4, 200)]), timedOut()],
    })
    await fake.go()
    expect(fake.replies).toHaveBeenCalledTimes(1)
  })

  it('returns an unreadable thread root as attention, never silently', async () => {
    const fake = start({ ...mine, calls: [result([commentEvent(4)])] })
    fake.run.commentAuthor = async () => {
      throw new Error('404')
    }
    const out = await fake.go()
    expect(out.attention).toMatchObject([{ pr: 4, exitCode: 13, reason: '404' }])
  })
})

describe('wait: gaps, errors and the timeout', () => {
  it('returns a gap at once, with the cursor kept', async () => {
    const fake = start({ calls: [result([labelEvent(4)], { gap: true, cursor: 'g' })] })
    const out = await fake.go()
    expect(out).toMatchObject({ outcome: 'gap', exitCode: 0, gap: true, cursor: 'g', requests: [] })
    expect(readFileSync(join(dir, 'wait-test.cursor'), 'utf8')).toBe('g\n')
  })

  it('returns a hook-harness failure at once', async () => {
    const fake = start({ calls: [new Error('npx exited with 1')] })
    expect(await fake.go()).toMatchObject({
      outcome: 'error',
      exitCode: 13,
      error: 'npx exited with 1',
    })
  })

  it('reads a failed login as a configuration problem', async () => {
    const fake = start({ calls: [new Error('hook-harness: 401 run hook-harness login')] })
    expect(await fake.go()).toMatchObject({ outcome: 'error', exitCode: 12 })
  })

  it('retries a rate limit with a pause, then goes on', async () => {
    const fake = start({
      calls: [new Error('HTTP 429 too many requests'), new Error('rate limit'), timedOut()],
    })
    const out = await fake.go()
    expect(out).toMatchObject({ outcome: 'timeout', timedOut: true })
    expect(fake.sleep).toHaveBeenCalledTimes(2)
  })

  it('gives up on a rate limit that does not clear', async () => {
    const fake = start({ calls: Array.from({ length: 3 }, () => new Error('rate limit')) })
    expect(await fake.go()).toMatchObject({ outcome: 'error', exitCode: 13 })
    expect(fake.harness).toHaveBeenCalledTimes(3)
  })

  it('times out on its own when events keep coming that need nothing', async () => {
    const quiet = () => result([labelEvent(4, { issue: {} })])
    const fake = start({ calls: Array.from({ length: 10 }, quiet) })
    const out = await fake.go()
    expect(out).toMatchObject({ outcome: 'timeout', exitCode: 11, timedOut: true })
    expect(out.dropped.issue).toBe(10)
  })

  it('times out before any call when no time is left, with no cursor yet', async () => {
    const fake = start({ calls: [] })
    const out = await wait({ ...fake.waitOptions, timeoutSeconds: 0 }, fake.deps, fake.run)
    expect(out).toMatchObject({ outcome: 'timeout', timedOut: true, cursor: null })
    expect(fake.harness).not.toHaveBeenCalled()
  })

  it('reads an error that is not an Error', async () => {
    const fake = start({ calls: [] })
    fake.harness.mockRejectedValueOnce('plain text')
    expect(await fake.go()).toMatchObject({ outcome: 'error', exitCode: 13, error: 'plain text' })
  })

  it('returns a request that lacks a head when its check fails with a string', async () => {
    const noHead: HarnessEvent = { ...labelEvent(4) }
    delete noHead.headSha
    const fake = start({ labels: [REQUESTED], calls: [result([noHead])] })
    fake.deps.createIo.mockImplementation(() => {
      throw 'denied'
    })
    const out = await fake.go()
    expect(out.requests).toEqual([{ repo, pr: 4, headSha: null }])
    expect(out.problems[0]).toContain('denied')
  })

  it('drops events that name no repository or no pull request', async () => {
    const lost: HarnessEvent = { ...commentEvent(4) }
    delete lost.repo
    const noPrs: HarnessEvent = { ...commentEvent(4) }
    delete noPrs.prs
    const fake = start({ calls: [result([lost, noPrs]), timedOut()] })
    const out = await fake.go()
    expect(out.dropped['no pull request']).toBe(2)
  })

  it('returns a replies run that throws a string as a failure', async () => {
    const fake = start({
      labels: [],
      reviews: [marker('Request-Changes')],
      calls: [result([commentEvent(4)])],
    })
    fake.replies.mockRejectedValueOnce('nope')
    expect((await fake.go()).attention).toMatchObject([{ reason: 'nope' }])
  })
})
