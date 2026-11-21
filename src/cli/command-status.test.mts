import { afterEach, describe, expect, it, vi } from 'vitest'

import type { ListedReview } from '../review/github.mts'
import { NO_CONFIGS } from '../review/rules/config.mts'
import { runReviewCommand } from './command.mts'
import type { ReviewDeps } from './deps.mts'

const SHA = 'e'.repeat(40)
const PR = ['--repo', 'acme/widgets', '--pr', '4']

const marked = (verdict: string, effort: string): ListedReview => ({
  id: 1,
  url: 'https://example.test/r',
  body: `<!-- final-review sha=${SHA} verdict=${verdict} effort=${effort} -->`,
  author: 'bot',
})

function statusDeps(reviews: ListedReview[], approval: boolean, completed: boolean) {
  return {
    authMode: () => 'gh',
    configs: () => NO_CONFIGS,
    targetConfig: async () => ({ config: undefined, problems: [] }),
    createLabelIo: () => ({
      labels: async () => (completed ? ['final-review:complete'] : ['final-review:in-progress']),
    }),
    createIo: () => ({
      headSha: async () => SHA,
      listReviews: async () => reviews,
      hasApprovalLabel: async () => approval,
      trustedAuthors: async () => new Set(['bot']),
    }),
  } as unknown as ReviewDeps
}

function capture() {
  const out: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  return out
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('status exit codes', () => {
  it('exits 0 for an approved status and 1 otherwise', async () => {
    const out = capture()
    const approved = statusDeps([marked('Approve', 'high')], true, false)
    await expect(runReviewCommand(['status', ...PR], approved)).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ approved: true })
    await expect(runReviewCommand(['status', ...PR], statusDeps([], true, false))).resolves.toBe(1)
  })

  it('exits 0 for a skipped head even without the approval label', async () => {
    const out = capture()
    const reviews = [marked('Skipped', 'low')]
    await expect(
      runReviewCommand(['status', ...PR], statusDeps(reviews, false, true)),
    ).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ approved: false, skipped: true })
    // A forced re-review swapped the completed label for the in-progress one.
    out.length = 0
    await expect(
      runReviewCommand(['status', ...PR], statusDeps(reviews, false, false)),
    ).resolves.toBe(1)
    expect(JSON.parse(out.join(''))).toMatchObject({ skipped: false })
  })
})
