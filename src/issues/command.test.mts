import { describe, expect, it } from 'vitest'

import { memoryTracker } from '../outcomes/github-fake-io.mts'
import { saveOutcomes } from '../outcomes/store.mts'
import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import type { TrackerIo } from '../tracker/types.mts'
import { issuesCommand, issuesProblems, resolveIssues } from './command.mts'
import { DAY_MS } from './file.mts'
import { badRule, fakeIssuesIo, NOW, row } from './issues-fake-io.mts'
import { appendFiled, ISSUES_FILE, readFiled } from './record.mts'

const text = (repo: string) => JSON.stringify({ issues: { targets: [{ name: 'a', repo }] } })

function configsOf(
  owners: Record<string, string>,
  repos: Record<string, string> = {},
  problems: string[] = [],
): RepoConfigs {
  const parse = (map: Record<string, string>, scope: 'owner' | 'repo') =>
    new Map(Object.entries(map).map(([name, body]) => [name, parseRepoConfig(body, name, scope)]))
  return { byOwner: parse(owners, 'owner'), byRepo: parse(repos, 'repo'), problems }
}

function seeded(rows = badRule('a:x')): TrackerIo {
  const tracker = { ...memoryTracker(), now: () => NOW }
  saveOutcomes(tracker, rows)
  return tracker
}

describe('resolveIssues', () => {
  it('is undefined without the key', () => {
    expect(resolveIssues(NO_CONFIGS)).toBeUndefined()
  })

  it('takes the first owner file by name, then repository files', () => {
    const owners = { zed: text('acme/z'), amy: text('acme/amy') }
    expect(resolveIssues(configsOf(owners))?.targets[0]?.repo).toBe('acme/amy')
    expect(
      resolveIssues(configsOf({}, { 'acme/w': text('acme/w-issues') }))?.targets[0]?.repo,
    ).toBe('acme/w-issues')
  })
})

describe('issuesProblems', () => {
  it('picks only problems about the issues key', () => {
    const configs = configsOf({}, {}, [
      'a.json issues.maxPerDay: must be an integer of at least 1; issues ignored',
      'b.json: issues is machine-only; ignored',
      'c.json: unknown key "issuesX" ignored',
      'd.json limits: bad',
    ])
    expect(issuesProblems(configs)).toHaveLength(2)
  })
})

describe('issuesCommand', () => {
  it('fails on an invalid issues config, before any call', async () => {
    const { io, calls } = fakeIssuesIo()
    const configs = configsOf({}, {}, ['a.json issues.targets: must be a list; issues ignored'])
    await expect(issuesCommand({}, configs, seeded(), io)).rejects.toThrow(/invalid issues config/u)
    expect(calls).toEqual([])
  })

  it('proposes a harness from recorded failures inside the window only', async () => {
    const tracker = seeded([])
    const file = `${tracker.dir}/harness-failures.jsonl`
    const row = (at: string) =>
      `${JSON.stringify({ at, harness: 'claude', step: 'verifier', kind: 'crash', run: at })}\n`
    const recent = new Date(NOW.getTime() - DAY_MS).toISOString()
    const old = new Date(NOW.getTime() - 60 * DAY_MS).toISOString()
    tracker.append(file, row(recent).repeat(3))
    tracker.append(file, row(old).repeat(5))
    const body = JSON.stringify({ issues: { targets: [{ name: 'harness', repo: 'acme/r' }] } })
    const configs = configsOf({ acme: body })
    const { io } = fakeIssuesIo()
    const { result } = await issuesCommand({ 'dry-run': true }, configs, tracker, io)
    expect(result.filed).toEqual([{ key: 'harness:claude:crash', repo: 'acme/r', url: null }])
  })

  it('files nothing when no issues key is configured', async () => {
    const { io, calls } = fakeIssuesIo()
    const { result } = await issuesCommand({}, NO_CONFIGS, seeded(), io)
    expect(result.filed).toEqual([])
    expect(result.skipped).toHaveLength(1)
    expect(calls).toEqual([])
  })

  it('files from stored outcomes within --since, and honours --dry-run', async () => {
    const tracker = seeded([
      ...badRule('a:x'),
      ...Array.from({ length: 3 }, () =>
        row('disputed', {
          rule: 'a:stale',
          checkedAt: new Date(NOW.getTime() - 3 * DAY_MS).toISOString(),
        }),
      ),
    ])
    const configs = configsOf({ acme: text('acme/a-rules') })
    const { io, calls } = fakeIssuesIo()
    const dry = await issuesCommand({ 'dry-run': true, since: '2' }, configs, tracker, io)
    expect(dry.result).toEqual({
      filed: [{ key: 'rule:a:x:review', repo: 'acme/a-rules', url: null }],
      skipped: [],
      dryRun: true,
    })
    expect(calls.every((call) => call.args[1] === 'list')).toBe(true)
    const wide = await issuesCommand({ since: '5' }, configs, tracker, fakeIssuesIo().io)
    expect(wide.result.filed.map((item) => item.key)).toEqual([
      'rule:a:stale:review',
      'rule:a:x:review',
    ])
    expect(readFiled(tracker)).toHaveLength(2)
  })

  it.each(['0', 'x', '1.5'])('rejects --since %s', async (since) => {
    await expect(issuesCommand({ since }, NO_CONFIGS, seeded(), fakeIssuesIo().io)).rejects.toThrow(
      '--since must be a positive integer.',
    )
  })

  it('ignores a record line that is not a row', async () => {
    const tracker = seeded()
    tracker.append(`${tracker.dir}/${ISSUES_FILE}`, 'not json\n{"key":1}\n')
    appendFiled(tracker, { key: 'k', repo: 'r', url: 'u', filedAt: NOW.toISOString() })
    expect(readFiled(tracker)).toHaveLength(1)
  })
})
