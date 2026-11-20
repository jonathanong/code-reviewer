import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createTrackerIo } from './io.mts'
import { recordPosted, recordReview, type ReviewRun } from './record.mts'
import { readRows } from './store.mts'
import type { TrackerIo } from './types.mts'

const FIXTURES = resolve(import.meta.dirname, 'fixtures')
const HEAD = 'a'.repeat(40)
const dirs: string[] = []

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tracker(): TrackerIo {
  const dir = join(mkdtempSync(join(tmpdir(), 'tracker-')), 'state')
  dirs.push(dir)
  return {
    ...createTrackerIo({ CODE_REVIEWER_STATE_DIR: dir }),
    now: () => new Date('2026-02-03T04:05:06.000Z'),
  }
}

function run(out: string, overrides: Partial<ReviewRun> = {}): ReviewRun {
  return {
    repo: 'acme/widgets',
    pr: 4,
    out: join(FIXTURES, out),
    startedAt: '2026-02-03T03:00:00.000Z',
    ok: true,
    summary: {
      claimed: true,
      mode: 'full',
      verdict: 'Comment',
      findings: { blocking: 0, high: 1, medium: 0, low: 2 },
      costUsd: 2.5,
      review: 'review.json',
      headSha: HEAD,
    },
    ...overrides,
  }
}

describe('recordReview', () => {
  it('records a reviewed run with what the run directory and the summary know', () => {
    const io = tracker()
    expect(recordReview(io, run('full'))).toEqual({})
    expect(readRows(io).rows).toEqual([
      {
        repo: 'acme/widgets',
        pr: 4,
        head: HEAD,
        state: 'reviewed',
        title: 'Add widget caching',
        author: 'octocat',
        mode: 'full',
        verdict: 'Comment',
        counts: { blocking: 0, high: 1, medium: 0, low: 2 },
        questions: 2,
        costUsd: 2.5,
        startedAt: '2026-02-03T03:00:00.000Z',
        finishedAt: '2026-02-03T04:05:06.000Z',
        reason: null,
        reviewUrl: null,
        event: null,
        postedAt: null,
        runDir: join(FIXTURES, 'full'),
      },
    ])
  })

  it('records a review of the changes since the last review as a follow-up', () => {
    const io = tracker()
    recordReview(io, run('follow-up', { summary: { ...run('x').summary, mode: 'light' } }))
    expect(readRows(io).rows[0]).toMatchObject({ mode: 'follow-up', questions: null, title: null })
  })

  it('records a skipped pull request with the plan reason', () => {
    const io = tracker()
    recordReview(
      io,
      run('skipped', { summary: { claimed: true, mode: 'skip', verdict: null, review: null } }),
    )
    expect(readRows(io).rows[0]).toMatchObject({
      state: 'skipped',
      mode: 'skip',
      reason: 'Only documentation changed.',
      verdict: null,
      counts: { blocking: 0, high: 0, medium: 0, low: 0 },
    })
  })

  it('records a skip whose plan is missing with a generic reason', () => {
    const io = tracker()
    recordReview(io, run('missing', { summary: { claimed: true, review: null } }))
    expect(readRows(io).rows[0]).toMatchObject({ state: 'skipped', reason: 'skipped' })
  })

  it('records a failed run with its error, and the head the run directory knows', () => {
    const io = tracker()
    recordReview(
      io,
      run('full', { ok: false, summary: { claimed: true, error: 'every pillar failed' } }),
    )
    expect(readRows(io).rows[0]).toMatchObject({
      state: 'failed',
      reason: 'every pillar failed',
      head: '1111111111111111111111111111111111111111',
      counts: null,
      costUsd: null,
    })
  })

  it('records a failure with no readable run files under an empty head', () => {
    const io = { ...tracker(), read: () => '{ not json' }
    recordReview(io, run('broken', { ok: false, summary: { error: 'no claim' } }))
    const plain = createTrackerIo({ CODE_REVIEWER_STATE_DIR: io.dir })
    expect(readRows(plain).rows[0]).toMatchObject({ state: 'failed', head: '', title: null })
  })

  it('records nothing when another run holds the claim', () => {
    const io = tracker()
    expect(recordReview(io, run('full', { summary: { claimed: false } }))).toEqual({})
    expect(readRows(io).rows).toEqual([])
  })

  it('reports a tracker failure and still returns', () => {
    const io = {
      ...tracker(),
      append: () => {
        throw new Error('disk full')
      },
    }
    expect(recordReview(io, run('full'))).toEqual({
      trackerProblem: 'the tracker could not record this run: disk full',
    })
  })

  it('reports a failure that is not an Error', () => {
    const io = {
      ...tracker(),
      now: () => {
        throw 'clock stopped'
      },
    }
    expect(recordReview(io, run('full')).trackerProblem).toContain('clock stopped')
  })
})

describe('recordPosted', () => {
  const outcome = {
    verdict: 'Request Changes' as const,
    reviews: [{ event: 'COMMENT' as const, commit_id: HEAD, body: 'b', comments: [] }],
    urls: ['https://example.test/review/1', 'https://example.test/review/2'],
    label: 'unchanged' as const,
  }
  const finding = (severity: 'blocking' | 'low') => ({
    pillar: 'rules' as const,
    severity,
    title: 't',
    body: 'b',
  })

  it('records the review link, event and counts against the run directory of the input', () => {
    const io = tracker()
    const input = join(FIXTURES, 'full', 'review.json')
    expect(
      recordPosted(io, {
        repo: 'acme/widgets',
        pr: 4,
        headSha: HEAD,
        input,
        findings: [finding('blocking'), finding('low'), finding('low')],
        outcome,
      }),
    ).toEqual({})
    expect(readRows(io).rows[0]).toMatchObject({
      state: 'posted',
      head: HEAD,
      verdict: 'Request Changes',
      counts: { blocking: 1, high: 0, medium: 0, low: 2 },
      reviewUrl: 'https://example.test/review/1',
      event: 'COMMENT',
      postedAt: '2026-02-03T04:05:06.000Z',
      runDir: join(FIXTURES, 'full'),
    })
  })

  it('records a post that produced no review link or event', () => {
    const io = tracker()
    recordPosted(io, {
      repo: 'acme/widgets',
      pr: 4,
      headSha: HEAD,
      input: 'review.json',
      findings: [],
      outcome: { ...outcome, reviews: [], urls: [] },
    })
    expect(readRows(io).rows[0]).toMatchObject({ reviewUrl: null, event: null })
  })

  it('reports a tracker failure and still returns', () => {
    const io = {
      ...tracker(),
      append: () => {
        throw new Error('read-only')
      },
    }
    expect(
      recordPosted(io, {
        repo: 'acme/widgets',
        pr: 4,
        headSha: HEAD,
        input: 'review.json',
        findings: [],
        outcome,
      }).trackerProblem,
    ).toContain('read-only')
  })
})
