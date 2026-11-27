import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { digestCommand, outcomesCommand } from './command.mts'
import { MAX_PULLS } from './collect.mts'
import { fakeGh, io, posted, review, seeded, thread } from './github-fake-io.mts'
import { readMisses, readOutcomes } from './store.mts'

const pull = {
  reviews: [review(100)],
  threads: [thread({ id: 1 }), thread({ id: 2, resolved: true })],
}

describe('outcomesCommand', () => {
  it('summarises counts, stores the rows, and is idempotent when run again', async () => {
    const tracker = seeded()
    const gh = fakeGh({ 7: pull })
    const first = await outcomesCommand({ repo: ['acme/widgets'] }, tracker, io({}, gh))
    expect(first.summary).toEqual({
      pulls: 1,
      findings: 2,
      stored: 2,
      candidateMisses: 0,
      notChecked: 0,
      byOutcome: {
        fixed: 1,
        disputed: 0,
        dismissed: 0,
        open: 1,
        ignored: 0,
        resolved: 0,
        rejected: 0,
      },
    })
    const second = await outcomesCommand(
      { repo: ['acme/widgets'] },
      tracker,
      io({}, fakeGh({ 7: { ...pull, state: 'MERGED' } })),
    )
    expect(second.summary).toMatchObject({ findings: 2, stored: 2 })
    expect(
      readOutcomes(tracker)
        .map((row) => row.outcome)
        .sort(),
    ).toEqual(['fixed', 'ignored'])
  })

  it('stores candidate misses beside the rows, replacing them by key on a re-run', async () => {
    const tracker = seeded()
    const threads = [
      thread({ id: 9, author: 'coderabbitai[bot]', outdated: true, path: 'src/b.ts' }),
    ]
    const gh = fakeGh({ 7: { reviews: [review(100)], threads } })
    const first = await outcomesCommand({ repo: ['acme/widgets'] }, tracker, io({}, gh))
    expect(first.summary).toMatchObject({ findings: 0, candidateMisses: 1 })
    await outcomesCommand({ repo: ['acme/widgets'] }, tracker, io({}, gh))
    expect(readMisses(tracker).map((miss) => miss.key)).toEqual(['acme/widgets#7/thread/9'])
    expect(readOutcomes(tracker)).toEqual([])
  })

  it('takes --owner, --pr and --since', async () => {
    const result = await outcomesCommand(
      { owner: 'acme', pr: '7', since: '5' },
      seeded(),
      io({}, fakeGh({ 7: pull })),
    )
    expect(result.summary).toMatchObject({ pulls: 1 })
  })

  it('says how many pull requests were not checked', async () => {
    const rows = Array.from({ length: MAX_PULLS + 2 }, (_, index) => posted({ pr: index + 1 }))
    const all = Object.fromEntries(rows.map((row) => [row.pr, pull]))
    const { messages } = await outcomesCommand(
      { repo: ['acme/widgets'] },
      seeded(...rows),
      io({}, fakeGh(all)),
    )
    expect(messages).toEqual([`2 more pull requests not checked (at most ${MAX_PULLS} per run).`])
  })

  it('fails fast on missing scope or a bad number', async () => {
    await expect(outcomesCommand({}, seeded(), io())).rejects.toThrow(
      'outcomes needs --repo or --owner.',
    )
    await expect(outcomesCommand({ repo: ['a/b'], pr: 'x' }, seeded(), io())).rejects.toThrow(
      '--pr must be a positive integer.',
    )
    await expect(outcomesCommand({ repo: ['a/b'], since: '0' }, seeded(), io())).rejects.toThrow(
      '--since must be a positive integer.',
    )
  })
})

describe('digestCommand', () => {
  it('defaults the day to today and the directory to the state directory', () => {
    const tracker = seeded()
    const { path } = digestCommand({}, tracker)
    expect(path).toBe(join(tracker.dir, 'outcomes-2026-06-10.md'))
    expect(readFileSync(path, 'utf8')).toContain('0 findings recorded')
  })

  it('takes --day and --out', () => {
    const tracker = seeded()
    const out = join(tracker.dir, 'elsewhere')
    expect(digestCommand({ day: '2026-01-02', out }, tracker).path).toBe(
      join(out, 'outcomes-2026-01-02.md'),
    )
  })
})
