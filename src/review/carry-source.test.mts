import { describe, expect, it } from 'vitest'

import { appendRow } from '../tracker/store.mts'
import type { TrackerIo, TrackerRow } from '../tracker/types.mts'
import { carriedReviewInput, verifyApprovedSource } from './carry-source.mts'
import type { ListedReview } from './github.mts'
import { narrationWarnings } from './narration.mts'
import { deriveVerdict } from './render.mts'

const OLD = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const PULL = { repo: 'acme/widgets', pr: 7 }

function review(
  sha: string,
  verdict: string,
  effort = 'high',
  author: string | null = 'bot',
): ListedReview {
  return {
    id: 1,
    url: 'https://example.test/r',
    body: `<!-- final-review sha=${sha} verdict=${verdict} effort=${effort} -->`,
    author,
  }
}

function makeIo(reviews: ListedReview[], trusted = new Set(['bot'])) {
  return {
    listReviews: async () => reviews,
    trustedAuthors: async () => trusted,
  }
}

function makeTracker(files: Record<string, string> = {}): TrackerIo {
  const map = new Map(Object.entries(files))
  return {
    dir: '/state',
    read: (path) => map.get(path),
    append: (path, text) => void map.set(path, `${map.get(path) ?? ''}${text}`),
    write: (path, text) => void map.set(path, text),
    now: () => new Date('2026-05-06T07:08:09.000Z'),
  }
}

function row(overrides: Partial<TrackerRow>): TrackerRow {
  return {
    repo: PULL.repo,
    pr: PULL.pr,
    head: OLD,
    state: 'posted',
    title: null,
    author: null,
    mode: null,
    verdict: 'Approve',
    counts: null,
    questions: null,
    costUsd: null,
    startedAt: null,
    finishedAt: null,
    reason: null,
    reviewUrl: 'https://example.test/r',
    reviewId: 1,
    event: 'APPROVE',
    downgraded: null,
    postedAt: '2026-05-06T07:08:09.000Z',
    runDir: null,
    ...overrides,
  }
}

describe('verifyApprovedSource', () => {
  it('accepts a trusted GitHub Approve review on OLD and preserves its effort', async () => {
    const io = makeIo([review(OLD, 'Request-Changes', 'medium'), review(OLD, 'Approve', 'high')])
    await expect(verifyApprovedSource(io, makeTracker(), PULL, OLD)).resolves.toEqual({
      effort: 'high',
    })
  })

  it('defaults effort to high when the trusted marker has an unrecognized effort', async () => {
    const io = makeIo([review(OLD, 'Approve', 'unknown')])
    await expect(verifyApprovedSource(io, makeTracker(), PULL, OLD)).resolves.toEqual({
      effort: 'high',
    })
  })

  it('refuses to carry when GitHub shows Approve but the local tracker records a different verdict', async () => {
    const io = makeIo([review(OLD, 'Approve', 'high')])
    const disagree = makeTracker()
    appendRow(disagree, row({ state: 'posted', verdict: 'Request Changes' }))
    await expect(verifyApprovedSource(io, disagree, PULL, OLD)).rejects.toThrow(
      'GitHub shows Approve, but local tracker records Request Changes',
    )

    const savedDisagree = makeTracker({
      '/run/review.json': JSON.stringify({
        effort: 'high',
        findings: [{ pillar: 'rules', severity: 'high', title: 'T', body: 'B' }],
      }),
    })
    appendRow(savedDisagree, row({ state: 'posted', verdict: null, runDir: '/run' }))
    await expect(verifyApprovedSource(io, savedDisagree, PULL, OLD)).rejects.toThrow(
      'GitHub shows Approve, but local tracker records Comment',
    )

    const agree = makeTracker()
    appendRow(agree, row({ state: 'posted', verdict: 'Approve' }))
    await expect(verifyApprovedSource(io, agree, PULL, OLD)).resolves.toEqual({ effort: 'high' })

    const noVerdict = makeTracker()
    appendRow(noVerdict, row({ state: 'failed', verdict: null, runDir: null }))
    await expect(verifyApprovedSource(io, noVerdict, PULL, OLD)).resolves.toEqual({
      effort: 'high',
    })
  })

  it('rejects when the newest trusted review on OLD requested changes or only commented', async () => {
    const req = makeIo([review(OLD, 'Approve'), review(OLD, 'Request-Changes')])
    await expect(verifyApprovedSource(req, makeTracker(), PULL, OLD)).rejects.toThrow(
      'newest review is Request Changes, not Approve',
    )
    const comment = makeIo([review(OLD, 'Approve'), review(OLD, 'Comment')])
    await expect(verifyApprovedSource(comment, makeTracker(), PULL, OLD)).rejects.toThrow(
      'newest review is Comment, not Approve',
    )
  })

  it('ignores untrusted reviews and Skipped notices on OLD', async () => {
    const forged = makeIo([review(OLD, 'Approve', 'high', 'attacker')])
    await expect(verifyApprovedSource(forged, makeTracker(), PULL, OLD)).rejects.toThrow(
      'no posted Approve review found',
    )
    const skipped = makeIo([review(OLD, 'Skipped', 'low')])
    await expect(verifyApprovedSource(skipped, makeTracker(), PULL, OLD)).rejects.toThrow(
      'no posted Approve review found',
    )
    const differentSha = makeIo([review(OTHER, 'Approve')])
    await expect(verifyApprovedSource(differentSha, makeTracker(), PULL, OLD)).rejects.toThrow(
      'no posted Approve review found',
    )
  })

  it('falls back to a posted Approve row in the machine-local tracker with default high effort', async () => {
    const tracker = makeTracker()
    appendRow(tracker, row({ verdict: 'Approve', runDir: null }))
    await expect(verifyApprovedSource(makeIo([]), tracker, PULL, OLD)).resolves.toEqual({
      effort: 'high',
    })
  })

  it('reads verdict and effort from the saved run directory when the tracker row lacks verdict', async () => {
    const tracker = makeTracker({
      '/run/review.json': JSON.stringify({ effort: 'medium', findings: [] }),
    })
    appendRow(tracker, row({ verdict: null, runDir: '/run' }))
    await expect(verifyApprovedSource(makeIo([]), tracker, PULL, OLD)).resolves.toEqual({
      effort: 'medium',
    })
  })

  it('rejects when the saved run directory verdict is not Approve or cannot be read', async () => {
    const blocking = makeTracker({
      '/run/review.json': JSON.stringify({
        effort: 'high',
        findings: [{ pillar: 'rules', severity: 'blocking', title: 'T', body: 'B' }],
      }),
    })
    appendRow(blocking, row({ verdict: null, runDir: '/run' }))
    await expect(verifyApprovedSource(makeIo([]), blocking, PULL, OLD)).rejects.toThrow(
      'newest review is Request Changes, not Approve',
    )

    const missingFile = makeTracker()
    appendRow(missingFile, row({ verdict: null, runDir: '/missing' }))
    await expect(verifyApprovedSource(makeIo([]), missingFile, PULL, OLD)).rejects.toThrow(
      'newest review is unknown, not Approve',
    )

    const invalidJson = makeTracker({ '/bad/review.json': '{not json' })
    appendRow(invalidJson, row({ verdict: null, runDir: '/bad' }))
    await expect(verifyApprovedSource(makeIo([]), invalidJson, PULL, OLD)).rejects.toThrow(
      'newest review is unknown, not Approve',
    )
  })

  it('rejects tracker rows that are not posted or not approvals', async () => {
    const unposted = makeTracker()
    appendRow(unposted, row({ state: 'reviewed', verdict: 'Approve' }))
    await expect(verifyApprovedSource(makeIo([]), unposted, PULL, OLD)).rejects.toThrow(
      'review state is reviewed, not posted',
    )

    const comment = makeTracker()
    appendRow(comment, row({ state: 'posted', verdict: 'Comment' }))
    await expect(verifyApprovedSource(makeIo([]), comment, PULL, OLD)).rejects.toThrow(
      'newest review is Comment, not Approve',
    )
  })
})

describe('carriedReviewInput', () => {
  it('builds a concise Approve summary with no first-person or narration warnings', () => {
    const identical = carriedReviewInput(OLD, 'high', [])
    expect(deriveVerdict(identical.findings, identical.questions, identical.skipped)).toBe(
      'Approve',
    )
    expect(identical.summary).toContain(OLD.slice(0, 12))
    expect(identical.summary).toContain('by diff')
    expect(identical.summary).not.toMatch(/\b(?:I|we|my|our)\b/iu)
    expect(narrationWarnings(identical)).toEqual([])

    const allowed = carriedReviewInput(OLD, 'medium', ['src/a.ts', 'src/b.ts'])
    expect(deriveVerdict(allowed.findings, allowed.questions, allowed.skipped)).toBe('Approve')
    expect(allowed.summary).toContain(OLD.slice(0, 12))
    expect(allowed.summary).toContain('`src/a.ts`')
    expect(allowed.summary).toContain('`src/b.ts`')
    expect(allowed.summary).not.toMatch(/\b(?:I|we|my|our)\b/iu)
    expect(narrationWarnings(allowed)).toEqual([])
  })
})
