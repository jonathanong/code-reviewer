import { describe, expect, it } from 'vitest'

import { memoryTracker } from '../outcomes/github-fake-io.mts'
import type { TrackerIo } from '../tracker/types.mts'
import type { IssuesConfig } from './config-parse.mts'
import { DAY_MS, fileIssues } from './file.mts'
import { badRule, fakeIssuesIo, NOW } from './issues-fake-io.mts'
import { appendFiled, readFiled } from './record.mts'

const config = (over: Partial<IssuesConfig> = {}): IssuesConfig => ({
  maxPerDay: 3,
  targets: [
    { name: 'a', repo: 'acme/a-rules', labels: ['from-code-reviewer', 'bot'] },
    { name: 'b', repo: 'acme/b-rules', labels: [] },
    { name: 'code-reviewer', repo: 'acme/reviewer', labels: [] },
  ],
  ...over,
})

const rowsFor = (...rules: string[]) => rules.flatMap(badRule)

function at(time: Date): TrackerIo {
  return { ...memoryTracker(), now: () => time }
}

const created = (calls: { args: string[] }[]) => calls.filter((call) => call.args[1] === 'create')

describe('fileIssues', () => {
  it('files nothing without an issues key, and says why', async () => {
    const { io, calls } = fakeIssuesIo()
    const { result } = await fileIssues(
      { config: undefined, rows: rowsFor('a:x'), dryRun: false },
      at(NOW),
      io,
    )
    expect(result).toEqual({
      filed: [],
      skipped: [{ key: 'rule:a:x:review', reason: 'no target "a" is configured' }],
      dryRun: false,
    })
    expect(calls).toEqual([])
  })

  it('files nothing for a plugin that has no target', async () => {
    const { io, calls } = fakeIssuesIo()
    const { result } = await fileIssues(
      { config: config(), rows: rowsFor('other:x'), dryRun: false },
      at(NOW),
      io,
    )
    expect(result.filed).toEqual([])
    expect(calls).toEqual([])
  })

  it('creates with title, a body file, and the target labels, and records the row', async () => {
    const tracker = at(NOW)
    const { io, calls, bodies } = fakeIssuesIo()
    const { result } = await fileIssues(
      { config: config(), rows: rowsFor('a:x'), dryRun: false },
      tracker,
      io,
    )
    expect(result.filed).toEqual([
      {
        key: 'rule:a:x:review',
        repo: 'acme/a-rules',
        url: 'https://example.test/acme/a-rules/issues/2',
      },
    ])
    expect(calls[0]?.args).toEqual([
      'issue',
      'list',
      '--repo',
      'acme/a-rules',
      '--search',
      '"rule:a:x:review" in:body',
      '--state',
      'open',
      '--json',
      'number,url,body',
    ])
    expect(created(calls)[0]).toEqual({
      repo: 'acme/a-rules',
      args: [
        'issue',
        'create',
        '--repo',
        'acme/a-rules',
        '--title',
        'Review rule a:x: 3 of 3 findings rejected or disputed',
        '--body-file',
        'body.md',
        '--label',
        'from-code-reviewer',
        '--label',
        'bot',
      ],
    })
    expect(bodies[0]?.trimEnd().endsWith('<!-- code-reviewer:issue rule:a:x:review -->')).toBe(true)
    expect(readFiled(tracker)).toEqual([
      {
        key: 'rule:a:x:review',
        repo: 'acme/a-rules',
        url: 'https://example.test/acme/a-rules/issues/2',
        filedAt: NOW.toISOString(),
      },
    ])
  })

  it('omits --label when the target has none', async () => {
    const { io, calls } = fakeIssuesIo()
    await fileIssues({ config: config(), rows: rowsFor('b:x'), dryRun: false }, at(NOW), io)
    expect(created(calls)[0]?.args).not.toContain('--label')
  })

  it('skips a proposal whose marker is in an open issue, and reports its URL', async () => {
    const { io, calls } = fakeIssuesIo({
      open: () => [
        { url: 'https://example.test/other', body: 'unrelated' },
        {
          url: 'https://example.test/found',
          body: 'x\n<!-- code-reviewer:issue rule:a:x:review -->\n',
        },
      ],
    })
    const { result } = await fileIssues(
      { config: config(), rows: rowsFor('a:x'), dryRun: false },
      at(NOW),
      io,
    )
    expect(result.skipped).toEqual([
      { key: 'rule:a:x:review', reason: 'an open issue exists: https://example.test/found' },
    ])
    expect(created(calls)).toEqual([])
  })

  it('reports a search that fails or answers badly, and files nothing for it', async () => {
    const failing = fakeIssuesIo()
    failing.io.gh = async () => {
      throw new Error('boom')
    }
    const garbled = fakeIssuesIo({ open: () => ({ not: 'a list' }) })
    for (const { io } of [failing, garbled]) {
      const { result } = await fileIssues(
        { config: config(), rows: rowsFor('a:x'), dryRun: false },
        at(NOW),
        io,
      )
      expect(result.filed).toEqual([])
      expect(result.skipped[0]?.reason).toMatch(/^failed: /u)
    }
  })

  it('skips without a search an issue this machine filed in the last 24 hours', async () => {
    const tracker = at(NOW)
    appendFiled(tracker, {
      key: 'rule:a:x:review',
      repo: 'acme/a-rules',
      url: 'https://example.test/old',
      filedAt: new Date(NOW.getTime() - DAY_MS + 1000).toISOString(),
    })
    const { io, calls } = fakeIssuesIo()
    const { result } = await fileIssues(
      { config: config(), rows: rowsFor('a:x'), dryRun: false },
      tracker,
      io,
    )
    expect(result.skipped[0]?.reason).toBe(
      'already filed in the last 24 hours: https://example.test/old',
    )
    expect(calls).toEqual([])
  })

  it('searches again once the record is 24 hours old', async () => {
    const tracker = at(NOW)
    appendFiled(tracker, {
      key: 'rule:a:x:review',
      repo: 'acme/a-rules',
      url: 'https://example.test/old',
      filedAt: new Date(NOW.getTime() - DAY_MS).toISOString(),
    })
    const { io, calls } = fakeIssuesIo()
    const { result } = await fileIssues(
      { config: config({ maxPerDay: 1 }), rows: rowsFor('a:x'), dryRun: false },
      tracker,
      io,
    )
    expect(calls[0]?.args[1]).toBe('list')
    expect(result.filed).toHaveLength(1)
  })

  it('stops at maxPerDay across all targets', async () => {
    const { io, calls } = fakeIssuesIo()
    const { result } = await fileIssues(
      { config: config({ maxPerDay: 2 }), rows: rowsFor('a:x', 'a:y', 'b:z'), dryRun: false },
      at(NOW),
      io,
    )
    expect(result.filed.map((item) => item.repo)).toEqual(['acme/a-rules', 'acme/a-rules'])
    expect(result.skipped).toEqual([
      { key: 'rule:b:z:review', reason: 'the limit of 2 issues per day is reached' },
    ])
    expect(created(calls)).toHaveLength(2)
  })

  it('counts issues recorded in the last 24 hours against the limit, but not older ones', async () => {
    const tracker = at(NOW)
    const filed = (key: string, ago: number) =>
      appendFiled(tracker, {
        key,
        repo: 'acme/b-rules',
        url: 'https://example.test/u',
        filedAt: new Date(NOW.getTime() - ago).toISOString(),
      })
    filed('old', DAY_MS + 1)
    filed('recent', 1000)
    const { io } = fakeIssuesIo()
    const { result } = await fileIssues(
      { config: config({ maxPerDay: 2 }), rows: rowsFor('a:x', 'a:y'), dryRun: false },
      tracker,
      io,
    )
    expect(result.filed).toHaveLength(1)
    expect(result.skipped).toHaveLength(1)
  })

  it('dry run searches but never creates or records, and still counts toward the limit', async () => {
    const tracker = at(NOW)
    const { io, calls } = fakeIssuesIo()
    const { result, messages } = await fileIssues(
      { config: config({ maxPerDay: 1 }), rows: rowsFor('a:x', 'a:y'), dryRun: true },
      tracker,
      io,
    )
    expect(result.dryRun).toBe(true)
    expect(result.filed).toEqual([{ key: 'rule:a:x:review', repo: 'acme/a-rules', url: null }])
    expect(result.skipped).toHaveLength(1)
    expect(messages[0]).toBe(
      'rule:a:x:review: would file in acme/a-rules: Review rule a:x: 3 of 3 findings rejected or disputed',
    )
    expect(created(calls)).toEqual([])
    expect(readFiled(tracker)).toEqual([])
  })

  it('isolates a failed create: it is skipped, not recorded, and does not use the limit', async () => {
    const tracker = at(NOW)
    const { io } = fakeIssuesIo({
      create: (repo) =>
        repo === 'acme/a-rules' ? new Error('HTTP 403') : 'https://example.test/ok/1',
    })
    const { result } = await fileIssues(
      { config: config({ maxPerDay: 1 }), rows: rowsFor('a:x', 'b:y'), dryRun: false },
      tracker,
      io,
    )
    expect(result.skipped).toEqual([{ key: 'rule:a:x:review', reason: 'failed: HTTP 403' }])
    expect(result.filed).toEqual([
      { key: 'rule:b:y:review', repo: 'acme/b-rules', url: 'https://example.test/ok/1' },
    ])
    expect(readFiled(tracker)).toHaveLength(1)
  })

  it('reports a create that prints no URL', async () => {
    const { io } = fakeIssuesIo({ create: () => 'nothing useful' })
    const { result } = await fileIssues(
      { config: config(), rows: rowsFor('a:x'), dryRun: false },
      at(NOW),
      io,
    )
    expect(result.filed).toEqual([])
    expect(result.skipped[0]?.reason).toBe('failed: gh issue create printed no issue URL')
  })

  it('reports a thrown non-error value', async () => {
    const { io } = fakeIssuesIo()
    io.gh = async () => Promise.reject('plain')
    const { result } = await fileIssues(
      { config: config(), rows: rowsFor('a:x'), dryRun: false },
      at(NOW),
      io,
    )
    expect(result.skipped[0]?.reason).toBe('failed: plain')
  })
})
