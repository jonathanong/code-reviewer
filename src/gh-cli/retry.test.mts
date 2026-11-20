import { describe, expect, it, vi } from 'vitest'

import {
  createRetrier,
  pauseForRetry,
  processRetrier,
  RETRY_POLICY,
  retryDelay,
  takeRetryCount,
  withRetry,
} from './retry.mts'

const READ = ['api', 'repos/o/r/pulls/1']
const REVIEW_POST = ['api', '--method', 'POST', 'repos/o/r/pulls/1/reviews', '--input', 'f']

function retrier() {
  const sleeps: number[] = []
  return {
    sleeps,
    value: createRetrier({
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      random: () => 0.5,
    }),
  }
}

/** A runner that fails with each message in turn, then answers `ok`. */
function flaky(failures: string[]) {
  const queue = [...failures]
  return vi.fn(async (_args: string[]) => {
    const next = queue.shift()
    if (next !== undefined) throw new Error(next)
    return 'ok'
  })
}

describe('withRetry', () => {
  it('retries a read through transient failures and counts them', async () => {
    const { value, sleeps } = retrier()
    const run = flaky(['HTTP 502: Bad Gateway', 'read ECONNRESET'])
    await expect(withRetry(run, value)(READ)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(3)
    expect(value.stats.retries).toBe(2)
    expect(sleeps).toEqual([750, 1500])
  })

  it('gives up after the attempt limit and throws the last error', async () => {
    const { value } = retrier()
    const run = flaky(Array.from({ length: 5 }, () => 'HTTP 503: down'))
    await expect(withRetry(run, value)(READ)).rejects.toThrow('HTTP 503')
    expect(run).toHaveBeenCalledTimes(RETRY_POLICY.maxAttempts)
  })

  it.each(['HTTP 401: Bad credentials', 'HTTP 404: Not Found', 'HTTP 422: Validation Failed'])(
    'fails a permanent failure at once: %s',
    async (message) => {
      const { value, sleeps } = retrier()
      const run = flaky([message])
      await expect(withRetry(run, value)(READ)).rejects.toThrow(message)
      expect(run).toHaveBeenCalledTimes(1)
      expect(sleeps).toEqual([])
    },
  )

  it('never retries a write that is not idempotent', async () => {
    const { value } = retrier()
    const run = flaky(['HTTP 504: Gateway Timeout'])
    await expect(withRetry(run, value)(REVIEW_POST)).rejects.toThrow('HTTP 504')
    expect(run).toHaveBeenCalledTimes(1)
    expect(value.stats.retries).toBe(0)
  })

  it('retries an idempotent write', async () => {
    const { value } = retrier()
    const run = flaky(['HTTP 502: Bad Gateway'])
    const labels = ['api', '--method', 'POST', 'repos/o/r/issues/1/labels', '-f', 'labels[]=x']
    await expect(withRetry(run, value)(labels)).resolves.toBe('ok')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('honours a named retry-after', async () => {
    const { value, sleeps } = retrier()
    const run = flaky(['HTTP 403: secondary rate limit. retry-after: 7'])
    await withRetry(run, value)(READ)
    expect(sleeps).toEqual([7000])
  })

  it('treats a repeated DELETE that finds the target gone as done', async () => {
    const { value } = retrier()
    const del = ['api', '--method', 'DELETE', 'repos/o/r/issues/1/labels/x', '--silent']
    const run = vi
      .fn<(args: string[]) => Promise<string>>()
      .mockRejectedValueOnce(new Error('HTTP 502: Bad Gateway'))
      .mockRejectedValueOnce(new Error('HTTP 404: Not Found'))
    await expect(withRetry(run, value)(del)).resolves.toBe('')
    const first404 = vi.fn().mockRejectedValue(new Error('HTTP 404: Not Found'))
    await expect(withRetry(first404, value)(del)).rejects.toThrow('HTTP 404')
  })
})

describe('withRetry dismissal', () => {
  const dismiss = [
    'api',
    '--method',
    'PUT',
    'repos/o/r/pulls/7/reviews/9/dismissals',
    '-f',
    'message=m',
  ]

  it('retries a dismissal and treats an already-dismissed answer on the repeat as done', async () => {
    const { value } = retrier()
    const run = vi
      .fn<(args: string[]) => Promise<string>>()
      .mockRejectedValueOnce(new Error('HTTP 504: Gateway Timeout'))
      .mockRejectedValueOnce(new Error('HTTP 422: Can not dismiss a dismissed pull request review'))
    await expect(withRetry(run, value)(dismiss)).resolves.toBe('')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('reports an already-dismissed answer on the first try as the error it is', async () => {
    const { value } = retrier()
    const run = vi
      .fn<(args: string[]) => Promise<string>>()
      .mockRejectedValue(new Error('HTTP 422: Can not dismiss a dismissed pull request review'))
    await expect(withRetry(run, value)(dismiss)).rejects.toThrow('HTTP 422')
    expect(run).toHaveBeenCalledOnce()
  })
})

describe('retryDelay', () => {
  it('doubles from the base, caps, and jitters between half and all of a step', () => {
    const at = (random: number, retry: number) =>
      retryDelay(createRetrier({ random: () => random }), { kind: 'permanent', reason: '' }, retry)
    expect(at(0, 1)).toBe(500)
    expect(at(0.999, 1)).toBe(1000)
    expect(at(0, 2)).toBe(1000)
    expect(at(0, 10)).toBe(RETRY_POLICY.maxDelayMs / 2)
  })

  it('caps a retry-after at the policy cap', () => {
    const failure = { kind: 'transient', reason: '', retryAfterMs: 999_999 } as const
    expect(retryDelay(createRetrier(), failure, 1)).toBe(RETRY_POLICY.retryAfterCapMs)
  })
})

describe('retrier', () => {
  it('waits on the real clock by default and counts through the process retrier', async () => {
    const real = createRetrier()
    await expect(real.sleep(0)).resolves.toBeUndefined()
    expect(real.random()).toBeLessThan(1)
    takeRetryCount()
    processRetrier.stats.retries = 2
    expect(takeRetryCount()).toBe(2)
    expect(takeRetryCount()).toBe(0)
  })

  it('pauseForRetry sleeps and counts', async () => {
    const { value, sleeps } = retrier()
    await pauseForRetry(value, { kind: 'transient', reason: 'x' }, 1)
    expect([sleeps, value.stats.retries]).toEqual([[750], 1])
  })
})
