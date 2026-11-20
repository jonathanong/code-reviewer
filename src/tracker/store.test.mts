import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createTrackerIo, stateHome } from './io.mts'
import { appendRow, foldRows, readRows, TRACKER_FILE } from './store.mts'
import type { TrackerRow } from './types.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tracker() {
  const dir = join(mkdtempSync(join(tmpdir(), 'tracker-')), 'state')
  dirs.push(dir)
  return createTrackerIo({ CODE_REVIEWER_STATE_DIR: dir })
}

function row(overrides: Partial<TrackerRow> = {}): TrackerRow {
  return {
    repo: 'acme/widgets',
    pr: 4,
    head: 'a'.repeat(40),
    state: 'reviewed',
    title: 'Add widgets',
    author: 'octocat',
    mode: 'full',
    verdict: 'Comment',
    counts: { blocking: 0, high: 1, medium: 0, low: 2 },
    questions: null,
    costUsd: 1.5,
    startedAt: '2026-01-01T00:00:00.000Z',
    finishedAt: '2026-01-01T00:10:00.000Z',
    reason: null,
    reviewUrl: null,
    reviewId: null,
    event: null,
    downgraded: null,
    postedAt: null,
    runDir: '/runs/4',
    ...overrides,
  }
}

describe('stateHome', () => {
  it('prefers CODE_REVIEWER_STATE_DIR, then the XDG state home, then ~/.local/state', () => {
    expect(stateHome({ CODE_REVIEWER_STATE_DIR: '/x', XDG_STATE_HOME: '/y' })).toBe('/x')
    expect(stateHome({ XDG_STATE_HOME: '/y' })).toBe('/y/code-reviewer')
    expect(stateHome({ HOME: '/home/me' })).toBe('/home/me/.local/state/code-reviewer')
    expect(stateHome({})).toMatch(/\.local\/state\/code-reviewer$/u)
  })
})

describe('tracker io', () => {
  it('creates the directory on the first append and reads back what was appended', () => {
    const io = tracker()
    const file = join(io.dir, TRACKER_FILE)
    expect(io.read(file)).toBeUndefined()
    io.append(file, 'a\n')
    io.append(file, 'b\n')
    expect(io.read(file)).toBe('a\nb\n')
    expect(io.now()).toBeInstanceOf(Date)
  })

  it('rethrows a read error that is not a missing file', () => {
    const io = tracker()
    io.append(join(io.dir, 'f'), 'x')
    expect(() => io.read(join(io.dir, 'f', 'g'))).toThrow()
  })
})

describe('readRows', () => {
  it('reads one row per line and reports a malformed line without losing the rest', () => {
    const io = tracker()
    appendRow(io, row())
    const file = join(io.dir, TRACKER_FILE)
    writeFileSync(
      file,
      [
        readFileSync(file, 'utf8').trim(),
        '{"repo": "acme/widgets", "pr":',
        '[1]',
        '{"repo":"acme/widgets","pr":5}',
        '{"repo":"acme/widgets","pr":5,"head":"b","state":"bogus"}',
        '',
        '{"repo":"acme/widgets","pr":6,"head":"c","state":"failed","reason":"boom"}',
      ].join('\n'),
    )
    const { rows, problems } = readRows(io)
    expect(rows.map((found) => found.pr)).toEqual([4, 6])
    expect(rows[1]).toMatchObject({ state: 'failed', reason: 'boom', title: null, counts: null })
    expect(problems).toEqual([
      'tracker line 2 was skipped: it is not valid JSON.',
      'tracker line 3 was skipped: it is not a JSON object.',
      'tracker line 4 was skipped: it lacks a repo, pr and head.',
      'tracker line 5 was skipped: its state is not one of reviewed, posted, skipped, failed.',
    ])
  })

  it('is empty when nothing was ever tracked', () => {
    expect(readRows(tracker())).toEqual({ rows: [], problems: [] })
  })
})

describe('foldRows', () => {
  it('lets a later row for the same repository, pull request and head replace an earlier one', () => {
    const folded = foldRows([
      row({ state: 'failed', reason: 'boom' }),
      row({ repo: 'ACME/Widgets', verdict: 'Approve' }),
      row({ head: 'b'.repeat(40) }),
    ])
    expect(folded).toHaveLength(2)
    expect(folded[0]).toMatchObject({ state: 'reviewed', verdict: 'Approve', reason: null })
  })

  it('adds a posted row to the review it follows and keeps what the posted row does not know', () => {
    const [folded] = foldRows([
      row(),
      row({
        state: 'posted',
        title: null,
        counts: null,
        reviewUrl: 'https://example.test/r',
        event: 'COMMENT',
        postedAt: '2026-01-01T01:00:00.000Z',
      }),
    ])
    expect(folded).toMatchObject({
      state: 'posted',
      title: 'Add widgets',
      counts: { blocking: 0, high: 1, medium: 0, low: 2 },
      reviewUrl: 'https://example.test/r',
      event: 'COMMENT',
    })
  })

  it('clears an earlier downgrade when the latest post has none', () => {
    const posted = (event: string, downgraded: string | null) =>
      row({ state: 'posted', counts: null, event, downgraded, reviewUrl: 'https://example.test/r' })
    const folded = foldRows([
      row(),
      posted('COMMENT', 'identity-unknown'),
      posted('APPROVE', null),
    ])[0]
    expect(folded).toMatchObject({ event: 'APPROVE', downgraded: null, title: 'Add widgets' })
  })

  it('starts over when a run is reviewed again after it was posted', () => {
    const [folded] = foldRows([
      row({ state: 'posted', reviewUrl: 'https://example.test/r' }),
      row({ state: 'reviewed' }),
    ])
    expect(folded).toMatchObject({ state: 'reviewed', reviewUrl: null })
  })

  it('keeps a posted row that has no earlier run as it is', () => {
    expect(foldRows([row({ state: 'posted', title: null })])).toHaveLength(1)
  })
})
