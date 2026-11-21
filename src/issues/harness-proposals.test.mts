import { describe, expect, it } from 'vitest'

import type { HarnessFailureKind } from '../harness/failure-kind.mts'
import { memoryTracker } from '../outcomes/github-fake-io.mts'
import type { HarnessFailureRow } from '../tracker/failures.mts'
import type { IssuesConfig } from './config-parse.mts'
import { fileIssues } from './file.mts'
import { HARNESS_MIN_FAILURES, harnessProposals } from './harness-proposals.mts'
import { fakeIssuesIo, NOW } from './issues-fake-io.mts'
import { markerOf } from './proposals.mts'

const failure = (over: Partial<HarnessFailureRow> = {}): HarnessFailureRow => ({
  at: '2026-06-01T08:00:00.000Z',
  harness: 'claude',
  step: 'security',
  kind: 'timeout',
  run: 'acme/secret-repo#9@abc',
  ...over,
})

const many = (n: number, over: Partial<HarnessFailureRow> = {}) =>
  Array.from({ length: n }, () => failure(over))

const config: IssuesConfig = {
  maxPerDay: 3,
  targets: [{ name: 'harness', repo: 'acme/reviewer', labels: ['harness'] }],
}

describe('harnessProposals', () => {
  it('proposes nothing below the threshold', () => {
    expect(harnessProposals(many(HARNESS_MIN_FAILURES - 1))).toEqual([])
  })

  it('proposes one issue per harness and kind, with counts, step names and dates only', () => {
    const rows = [
      failure({ at: '2026-06-03T00:00:00.000Z', step: 'verifier' }),
      failure({ at: '2026-06-01T00:00:00.000Z' }),
      failure({ step: 'my-private-pillar' }),
      ...many(3, { harness: 'grok', kind: 'crash' }),
    ]
    const [claude, grok, ...rest] = harnessProposals(rows)
    expect(rest).toEqual([])
    expect(claude).toEqual({
      key: 'harness:claude:timeout',
      target: 'harness',
      title: 'Harness claude: 3 steps failed (timed out)',
      body: [
        "The code reviewer's `claude` harness failed 3 steps: each timed out, between 2026-06-01 and 2026-06-03.",
        '',
        'Steps: configured pillar 1, security 1, verifier 1.',
        '',
        "Proposed: check the adapter's timeout handling and whether the harness hangs.",
        '',
        markerOf('harness:claude:timeout'),
        '',
      ].join('\n'),
    })
    expect(grok?.key).toBe('harness:grok:crash')
    for (const text of [claude?.body, claude?.title]) {
      expect(text).not.toContain('secret-repo')
      expect(text).not.toContain('my-private-pillar')
    }
  })

  it.each<HarnessFailureKind>([
    'timeout',
    'rate_limited',
    'overloaded',
    'unsupported_flag',
    'crash',
    'unparseable',
  ])('words a %s proposal', (kind) => {
    const [proposal] = harnessProposals(many(3, { kind }))
    expect(proposal?.key).toBe(`harness:claude:${kind}`)
    expect(proposal?.body).toContain('Proposed: check')
  })
})

describe('fileIssues with harness failures', () => {
  const tracker = () => ({ ...memoryTracker(), now: () => NOW })

  it('files in the harness target and dedups like the other kinds', async () => {
    const { io, calls } = fakeIssuesIo()
    const store = tracker()
    const input = { config, rows: [], failures: many(3), dryRun: false }
    const first = await fileIssues(input, store, io)
    expect(first.result.filed.map((filed) => filed.repo)).toEqual(['acme/reviewer'])
    const second = await fileIssues(input, store, io)
    expect(second.result.skipped[0]?.reason).toContain('already filed in the last 24 hours')
    expect(calls.filter((call) => call.args[1] === 'create')).toHaveLength(1)
  })

  it('files nothing when no target is named harness, and never creates on a dry run', async () => {
    const { io, calls } = fakeIssuesIo()
    const none = await fileIssues(
      { config: { maxPerDay: 3, targets: [] }, rows: [], failures: many(3), dryRun: false },
      tracker(),
      io,
    )
    expect(none.result.skipped[0]?.reason).toBe('no target "harness" is configured')
    const dry = await fileIssues(
      { config, rows: [], failures: many(3), dryRun: true },
      tracker(),
      io,
    )
    expect(dry.result.filed[0]?.url).toBeNull()
    expect(calls.filter((call) => call.args[1] === 'create')).toEqual([])
  })
})
