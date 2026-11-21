import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { MAX_LISTED, pastReviews } from './past-reviews.mts'
import type { ContextDeps, ContextInput } from './types.mts'

const stateDir = fileURLToPath(new URL('./fixtures/state', import.meta.url))
const HEAD = '5'.repeat(40)
const OLD = '1'.repeat(40)
const MID = '2'.repeat(40)

const input: ContextInput = {
  repo: 'acme/widgets',
  pr: 7,
  tree: '/tree',
  baseSha: '0'.repeat(40),
  headSha: HEAD,
  out: '/out',
  skills: [],
}

function enoent(path: string): Error {
  return Object.assign(new Error(`no such file: ${path}`), { code: 'ENOENT' })
}

/** Reads the fixture state directory; `files` replaces whole files by their fixture path. */
function fake(files: Record<string, string> = {}, exec?: ContextDeps['exec']) {
  const calls: string[][] = []
  const deps: ContextDeps = {
    exec:
      exec ??
      (async (command, args) => {
        calls.push([command, ...args])
        return args.includes('diff') ? ' src/a.ts | 2 +-\n 1 file changed\n' : ''
      }),
    readFile: async (path) => {
      const mapped = path.replace('/fixture-state', stateDir)
      const replaced = files[mapped.replace(`${stateDir}/`, '')]
      if (replaced !== undefined) return replaced
      try {
        return await readFile(mapped, 'utf8')
      } catch {
        throw enoent(path)
      }
    },
    gh: async () => '',
    trusted: async () => new Set<string>(),
    stateDir,
  }
  return { deps, calls }
}

const row = (extra: Record<string, unknown>) =>
  JSON.stringify({
    repo: 'acme/widgets',
    pr: 7,
    head: OLD,
    state: 'reviewed',
    startedAt: '2026-01-01T00:00:00Z',
    ...extra,
  })

describe('pastReviews', () => {
  it('lists this pull request reviews oldest first with findings and the re-review range', async () => {
    const { deps, calls } = fake()
    const section = await pastReviews.build(input, deps)
    const body = section?.body ?? ''
    expect(section?.title).toBe('Past reviews')
    expect(body.indexOf('111111111111')).toBeLessThan(body.indexOf('222222222222'))
    expect(body).toContain('full mode, verdict Request Changes, posted')
    expect(body).toContain('pullrequestreview-1')
    expect(body).toContain('2026-01-02')
    expect(body).toContain('  - [blocking] Token logged in clear (src/auth.ts:12)')
    expect(body).toContain('  - [low] Stale comment (no file)')
    expect(body).toContain('light mode, verdict Comment, reviewed (not posted)')
    expect(body).toContain('  - no findings')
    expect(body).not.toContain('333333333333')
    expect(body).not.toContain('444444444444')
    expect(body).toContain(`Re-review range: \`${MID}..${HEAD}\``)
    expect(body).toContain('/fixture-state/run-2/evidence.json (missing)')
    expect(body).toContain('src/a.ts | 2 +-')
    expect(calls).toContainEqual(['git', '-C', '/tree', 'diff', '--stat', `${MID}..${HEAD}`])
  })

  it('names the saved evidence file when it exists', async () => {
    const { deps } = fake({ 'reviews.jsonl': row({ runDir: '/fixture-state/run-1' }) })
    const body = (await pastReviews.build(input, deps))?.body ?? ''
    expect(body).toContain('Saved evidence: /fixture-state/run-1/evidence.json\n')
  })

  it('is null without a tracker or without reviews of this pull request', async () => {
    const none = fake({ 'reviews.jsonl': row({ pr: 99 }) })
    expect(await pastReviews.build(input, none.deps)).toBeNull()
    const missing: ContextDeps = {
      ...none.deps,
      stateDir: '/nowhere',
      readFile: async (p) => {
        throw enoent(p)
      },
    }
    expect(await pastReviews.build(input, missing)).toBeNull()
  })

  it('fails the build, which becomes a note, without a state directory', async () => {
    const { stateDir: _omitted, ...without } = fake().deps
    await expect(pastReviews.build(input, without)).rejects.toThrow('no state directory')
  })

  it('lets a tracker read failure other than a missing file fail the build', async () => {
    const { deps } = fake()
    const broken: ContextDeps = {
      ...deps,
      readFile: async () => {
        throw Object.assign(new Error('denied'), { code: 'EACCES' })
      },
    }
    await expect(pastReviews.build(input, broken)).rejects.toThrow('denied')
  })

  it('says what a missing or unreadable run directory could not tell', async () => {
    const { deps } = fake({
      'reviews.jsonl': [
        row({ runDir: null }),
        row({ head: MID, startedAt: '2026-01-02T00:00:00Z', runDir: '/fixture-state/gone' }),
        row({ head: HEAD, startedAt: null, runDir: '/fixture-state/bad' }),
      ].join('\n'),
      'bad/report.json': '{nope',
    })
    const body = (await pastReviews.build({ ...input, headSha: 'f'.repeat(40) }, deps))?.body ?? ''
    expect(body).toContain('no run directory is recorded')
    expect(body).toContain('its run directory is gone: /fixture-state/gone')
    expect(body).toContain('its report.json is not readable: /fixture-state/bad')
  })

  it('shows a finding with a file but no line, and skips a malformed findings list', async () => {
    const { deps } = fake({
      'reviews.jsonl': row({ runDir: '/fixture-state/run-2' }),
      'run-2/report.json': JSON.stringify({ findings: [{ title: 'Edge', path: 'a.ts' }] }),
    })
    expect((await pastReviews.build(input, deps))?.body).toContain('  - [?] Edge (a.ts)')
    const odd = fake({
      'reviews.jsonl': row({ runDir: '/fixture-state/run-2' }),
      'run-2/report.json': JSON.stringify({ findings: 'none' }),
    })
    expect((await pastReviews.build(input, odd.deps))?.body).toContain('  - no findings')
  })

  it('describes a bare row and a bare finding with placeholders', async () => {
    const bare = (head: string, runDir: string | null) =>
      JSON.stringify({ repo: 'acme/widgets', pr: 7, head, state: 'reviewed', runDir })
    const { deps } = fake({
      'reviews.jsonl': [bare(OLD, '/fixture-state/run-2'), bare(MID, null)].join('\n'),
      'run-2/report.json': JSON.stringify({ findings: [{}] }),
    })
    const body = (await pastReviews.build(input, deps))?.body ?? ''
    expect(body).toContain('unknown date, unknown mode, verdict none, reviewed (not posted)')
    expect(body).toContain('  - [?] untitled (no file)')
    expect(body.indexOf('111111111111')).toBeLessThan(body.indexOf('222222222222'))
  })

  it('says a posted review has no recorded link', async () => {
    const { deps } = fake({ 'reviews.jsonl': row({ state: 'posted' }) })
    expect((await pastReviews.build(input, deps))?.body).toContain('posted with no recorded link')
  })

  it('has no range when the latest review covered the current head', async () => {
    const { deps, calls } = fake({ 'reviews.jsonl': row({ head: HEAD, runDir: null }) })
    const body = (await pastReviews.build(input, deps))?.body ?? ''
    expect(body).toContain('Saved evidence: none')
    expect(body).toContain('covered the current head')
    expect(calls).toEqual([])
  })

  it('does not hand an unrecognised head to git', async () => {
    const { deps, calls } = fake({ 'reviews.jsonl': row({ head: '--output=x' }) })
    expect((await pastReviews.build(input, deps))?.body).toContain('not a commit id')
    expect(calls).toEqual([])
  })

  it('reports a range whose commits are not local', async () => {
    const { deps } = fake({}, async () => {
      throw new Error('fatal: bad object')
    })
    expect((await pastReviews.build(input, deps))?.body).toContain('not in the local checkout')
  })

  it('shows an empty diff and lists only the newest reviews', async () => {
    const rows = Array.from({ length: MAX_LISTED + 2 }, (_, i) =>
      row({ head: `${i + 1}`.repeat(40), startedAt: `2026-02-0${i + 1}T00:00:00Z` }),
    )
    const { deps } = fake({ 'reviews.jsonl': rows.join('\n') }, async () => '')
    const body = (await pastReviews.build(input, deps))?.body ?? ''
    expect(body).toContain('2 older reviews are not listed.')
    expect(body).toContain('no changes')
    expect(body).not.toContain('111111111111')
  })
})
