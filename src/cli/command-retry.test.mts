import { afterEach, describe, expect, it, vi } from 'vitest'

import { processRetrier, takeRetryCount } from '../gh-cli/index.mts'
import { runReviewCommand, type ReviewDeps } from './command.mts'

/** `bench` only forwards to `runBench`, so nothing else of the dependencies is touched. */
const benchDeps = { runBench: async () => 0 } as unknown as ReviewDeps

function capture() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk))
    return true
  })
  return { out, err }
}

afterEach(() => {
  vi.restoreAllMocks()
  takeRetryCount()
})

describe('retry warning', () => {
  it.each([
    [1, 'code-reviewer: warning: 1 GitHub call was retried after transient failures.\n'],
    [3, 'code-reviewer: warning: 3 GitHub calls were retried after transient failures.\n'],
  ])('reports %i retries once on stderr and keeps stdout clean', async (retries, warning) => {
    const { out, err } = capture()
    processRetrier.stats.retries = retries
    await runReviewCommand(['bench'], benchDeps)
    expect(err).toEqual([warning])
    expect(out).toEqual([])
    expect(takeRetryCount()).toBe(0)
  })

  it('says nothing when no call was retried', async () => {
    const { err } = capture()
    await runReviewCommand(['bench'], benchDeps)
    expect(err).toEqual([])
  })

  it('still reports retries when the command fails', async () => {
    const { err } = capture()
    processRetrier.stats.retries = 2
    await expect(runReviewCommand(['post'], benchDeps)).resolves.toBe(2)
    expect(err.at(-1)).toContain('2 GitHub calls were retried')
  })
})
