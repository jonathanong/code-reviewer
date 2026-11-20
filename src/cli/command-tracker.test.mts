import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createTrackerIo } from '../tracker/io.mts'
import { appendRow } from '../tracker/store.mts'
import type { TrackerIo, TrackerRow } from '../tracker/types.mts'
import { runReviewCommand } from './command.mts'
import { explainCommand, trackerCommand } from './command-tracker.mts'
import { createDefaultDeps } from './deps.mts'

const FIXTURES = resolve(import.meta.dirname, '../explain/fixtures')
const dirs: string[] = []

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tracker(): TrackerIo {
  const dir = join(mkdtempSync(join(tmpdir(), 'tracker-')), 'state')
  dirs.push(dir)
  return createTrackerIo({ CODE_REVIEWER_STATE_DIR: dir })
}

function row(overrides: Partial<TrackerRow>): TrackerRow {
  return {
    repo: 'acme/widgets',
    pr: 4,
    head: 'a'.repeat(40),
    state: 'reviewed',
    title: null,
    author: null,
    mode: null,
    verdict: null,
    counts: null,
    questions: null,
    costUsd: null,
    startedAt: null,
    finishedAt: '2026-03-01T00:00:00.000Z',
    reason: null,
    reviewUrl: null,
    event: null,
    postedAt: null,
    runDir: null,
    ...overrides,
  }
}

function seeded(): TrackerIo {
  const io = tracker()
  for (const entry of [
    row({ pr: 1, head: 'b'.repeat(40), finishedAt: '2026-01-01T00:00:00.000Z' }),
    row({ pr: 2, repo: 'Acme/Gadgets', state: 'failed', finishedAt: '2026-02-01T00:00:00.000Z' }),
    row({ pr: 3, state: 'skipped', finishedAt: null, startedAt: '2026-03-02T00:00:00.000Z' }),
    row({ pr: 5, state: 'posted', postedAt: '2026-04-01T00:00:00.000Z', finishedAt: null }),
    row({ pr: 6, finishedAt: null }),
  ]) {
    appendRow(io, entry)
  }
  return io
}

const prs = (output: string) => (JSON.parse(output) as TrackerRow[]).map((found) => found.pr)

describe('trackerCommand', () => {
  it('prints every folded row as JSON by default', () => {
    expect(prs(trackerCommand({}, seeded()).output)).toEqual([1, 2, 3, 5, 6])
  })

  it('filters by repository without regard to case, and takes several', () => {
    expect(prs(trackerCommand({ repo: ['acme/gadgets'] }, seeded()).output)).toEqual([2])
    expect(
      prs(trackerCommand({ repo: ['acme/gadgets', 'ACME/WIDGETS'] }, seeded()).output),
    ).toEqual([1, 2, 3, 5, 6])
  })

  it('filters by state', () => {
    expect(prs(trackerCommand({ state: 'failed' }, seeded()).output)).toEqual([2])
    expect(() => trackerCommand({ state: 'done' }, seeded())).toThrow(
      '--state must be one of reviewed, posted, skipped, failed.',
    )
  })

  it('filters by the date a run last changed, and leaves out a row with no date', () => {
    expect(prs(trackerCommand({ since: '2026-02-15' }, seeded()).output)).toEqual([3, 5])
    expect(() => trackerCommand({ since: 'last week' }, seeded())).toThrow(
      '--since must be an ISO date.',
    )
  })

  it('prints CSV and Markdown, and rejects another format', () => {
    expect(trackerCommand({ format: 'csv' }, seeded()).output.startsWith('repo,pr,')).toBe(true)
    expect(trackerCommand({ format: 'markdown' }, seeded()).output.startsWith('| repo |')).toBe(
      true,
    )
    expect(() => trackerCommand({ format: 'xml' }, seeded())).toThrow(
      '--format must be one of json, csv, markdown.',
    )
  })

  it('prints an empty list and no problems when nothing was tracked', () => {
    expect(trackerCommand({}, tracker())).toEqual({ output: '[]\n', problems: [] })
  })

  it('returns the problems of a malformed line beside the rows', () => {
    const io = tracker()
    appendRow(io, row({}))
    io.append(join(io.dir, 'reviews.jsonl'), 'oops\n')
    const { output, problems } = trackerCommand({}, io)
    expect(prs(output)).toEqual([4])
    expect(problems).toEqual(['tracker line 2 was skipped: it is not valid JSON.'])
  })
})

describe('explainCommand', () => {
  it('explains the run directory it is given', () => {
    const text = explainCommand({ run: join(FIXTURES, 'skipped') }, tracker())
    expect(text).toContain('Nothing was reviewed: Only documentation changed.')
  })

  it('explains the latest tracked run of a pull request that has a run directory', () => {
    const io = tracker()
    appendRow(
      io,
      row({ pr: 10, runDir: join(FIXTURES, 'thin'), finishedAt: '2026-01-01T00:00:00.000Z' }),
    )
    appendRow(io, row({ pr: 10, head: 'c'.repeat(40), runDir: join(FIXTURES, 'skipped') }))
    appendRow(
      io,
      row({ pr: 10, head: 'd'.repeat(40), runDir: null, finishedAt: '2026-09-01T00:00:00.000Z' }),
    )
    const text = explainCommand({ repo: ['Acme/Widgets'], pr: '10' }, io)
    expect(text).toContain('Nothing was reviewed: Only documentation changed.')
  })

  it('uses the tracked title when the run directory has none', () => {
    const io = tracker()
    appendRow(io, row({ pr: 7, title: 'Tracked title', runDir: join(FIXTURES, 'review-only') }))
    expect(explainCommand({ repo: ['acme/widgets'], pr: '7' }, io)).toContain(
      '# acme/widgets#7: Tracked title',
    )
  })

  it('says when a pull request has no tracked run to explain', () => {
    expect(() => explainCommand({ repo: ['acme/widgets'], pr: '7' }, seeded())).toThrow(
      'no tracked run with a run directory for acme/widgets#7.',
    )
  })

  it('needs --run, or --repo and --pr', () => {
    expect(() => explainCommand({}, tracker())).toThrow('explain needs --run, or --repo and --pr.')
    expect(() => explainCommand({ repo: ['acme/widgets'] }, tracker())).toThrow(
      'explain needs --run, or --repo and --pr.',
    )
  })
})

describe('the tracker and explain subcommands', () => {
  function run(args: string[], stateDir: string) {
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
    const deps = createDefaultDeps(
      () => {
        throw new Error('no GitHub call is made')
      },
      { CODE_REVIEWER_STATE_DIR: stateDir },
    )
    return runReviewCommand(args, deps).then((code) => ({
      code,
      out: out.join(''),
      err: err.join(''),
    }))
  }

  it('prints the tracker rows and reports a malformed line on stderr', async () => {
    const io = tracker()
    appendRow(io, row({ state: 'failed' }))
    io.append(join(io.dir, 'reviews.jsonl'), 'nope\n')
    const { code, out, err } = await run(
      ['tracker', '--state', 'failed', '--format', 'csv'],
      io.dir,
    )
    expect(code).toBe(0)
    expect(out).toContain('acme/widgets,4,')
    expect(err).toContain('code-reviewer: tracker line 2 was skipped')
  })

  it('prints the explainer for a run directory', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cmd-explain-'))
    dirs.push(dir)
    writeFileSync(join(dir, 'review.json'), JSON.stringify({ summary: 'Fine.', findings: [] }))
    const { code, out } = await run(['explain', '--run', dir], join(dir, 'state'))
    expect(code).toBe(0)
    expect(out).toContain('## Verdict: Approve')
  })

  it('exits 2 with the reason when explain has nothing to go on', async () => {
    const { code, err } = await run(['explain'], tracker().dir)
    expect(code).toBe(2)
    expect(err).toContain('explain needs --run, or --repo and --pr.')
  })
})
