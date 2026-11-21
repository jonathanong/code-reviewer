import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { foldRows, parseRows } from '../../tracker/store.mts'
import { previousReview } from './previous-review.mts'
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

/** Reads the fixture state directory; `ancestors` are the commits `merge-base` accepts. */
function fake(ancestors: string[], files: Record<string, string> = {}) {
  const calls: string[][] = []
  const deps: ContextDeps = {
    exec: async (_command, args) => {
      calls.push(args)
      if (!ancestors.includes(args[4] as string)) throw new Error('not an ancestor')
      return ''
    },
    readFile: async (path) => {
      const name = path.replace('/fixture-state/', '')
      if (files[name] !== undefined) return files[name]
      return await readFile(path.replace('/fixture-state', stateDir), 'utf8')
    },
    stateDir,
  }
  return { deps, calls }
}

async function rows() {
  const text = await readFile(`${stateDir}/reviews.jsonl`, 'utf8')
  const all = foldRows(parseRows(text).rows)
  return all.filter((row) => row.pr === 7 && row.state !== 'failed')
}

describe('previousReview', () => {
  it('reads the newest review whose head is an ancestor of the current head', async () => {
    const { deps, calls } = fake([OLD, MID])
    const found = await previousReview(await rows(), input, deps)
    expect(found).toEqual({
      previous: {
        sha: MID,
        date: '2026-01-05',
        mode: 'light',
        verdict: 'Comment',
        posted: false,
        reviewUrl: null,
        findings: [],
      },
      previousRunDir: '/fixture-state/run-2',
    })
    expect(calls[0]).toEqual(['-C', '/tree', 'merge-base', '--is-ancestor', MID, HEAD])
  })

  it('walks back to an older ancestor and keeps each finding as it was saved', async () => {
    const { deps } = fake([OLD])
    const { previous } = await previousReview(await rows(), input, deps)
    expect(previous).toMatchObject({ sha: OLD, posted: true, mode: 'full' })
    expect(previous?.reviewUrl).toContain('pullrequestreview-1')
    expect(previous?.findings).toEqual([
      {
        severity: 'blocking',
        title: 'Token logged in clear',
        pillar: null,
        path: 'src/auth.ts',
        line: 12,
      },
      { severity: 'low', title: 'Stale comment', pillar: null, path: null, line: null },
    ])
  })

  it('gives nothing when no reviewed commit is an ancestor, as after a force-push', async () => {
    const { deps } = fake([])
    expect(await previousReview(await rows(), input, deps)).toEqual({})
  })

  it('does not count a review of the current head or of this run directory', async () => {
    const { deps, calls } = fake([OLD, MID])
    const all = await rows()
    const same = all.map((row) => ({ ...row, head: HEAD }))
    expect(await previousReview(same, input, deps)).toEqual({})
    const here = all.map((row) => ({ ...row, runDir: '/out' }))
    expect(await previousReview(here, input, deps)).toEqual({})
    expect(calls).toEqual([])
  })

  it('ignores a recorded head that is not a commit id', async () => {
    const { deps, calls } = fake([OLD])
    const odd = (await rows()).map((row) => ({ ...row, head: 'not-a-sha' }))
    expect(await previousReview(odd, input, deps)).toEqual({})
    expect(calls).toEqual([])
  })

  it('says so, and uses no older review, when the run directory is gone', async () => {
    const { deps } = fake([OLD, MID])
    const gone = (await rows()).map((row) => ({ ...row, runDir: '/fixture-state/gone' }))
    const found = await previousReview(gone, input, deps)
    expect(found.previous).toBeUndefined()
    expect(found.previousNote).toContain('is gone')
  })

  it('says so when the report is not readable or no run directory is recorded', async () => {
    const { deps } = fake([MID], { 'run-2/report.json': '{nope' })
    const bad = await previousReview(await rows(), input, deps)
    expect(bad.previous).toBeUndefined()
    expect(bad.previousNote).toContain('not readable')
    const none = (await rows()).map((row) => ({ ...row, runDir: null }))
    expect((await previousReview(none, input, deps)).previousNote).toContain('no run directory')
  })

  it('reads a review with no findings list and no timestamp', async () => {
    const { deps } = fake([MID], { 'run-2/report.json': '{}' })
    const undated = (await rows()).map((row) => ({ ...row, startedAt: null, finishedAt: null }))
    const { previous } = await previousReview(undated, input, deps)
    expect(previous).toMatchObject({ sha: MID, date: null, findings: [] })
  })
})
