import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PLAN_VALUES } from './plan-settings.mts'
import { prepareReview } from './prepare.mts'
import { OLD, fakeIo } from './prepare-fake-io.mts'

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'prepare-sql-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

describe('prepareReview with SQL in source', () => {
  it('plans a full review for a small pull request whose diff changes SQL in source', async () => {
    const sqlPatch = [
      'diff --git a/src/feed.mts b/src/feed.mts',
      '--- a/src/feed.mts',
      '+++ b/src/feed.mts',
      '@@ -1,1 +1,1 @@',
      "+  const rows = await sql`select 1 where t > now() - interval '1 second'`",
      '',
    ].join('\n')
    const io = fakeIo({ lines: 5, paths: ['src/feed.mts'] })
    io.diff.mockResolvedValue(sqlPatch)
    const summary = await prepareReview(io, { out })
    expect(summary.plan.reasons).toEqual([
      'The pull request changes SQL in src/feed.mts: high effort.',
    ])
    const off = { ...DEFAULT_PLAN_VALUES, sqlInCode: false }
    expect((await prepareReview(io, { out, values: off })).mode).toBe('light')
    const follow = fakeIo({ reviewed: OLD, lines: 200, paths: ['src/feed.mts'] })
    follow.compareDiff.mockResolvedValue(sqlPatch)
    const next = await prepareReview(follow, { out })
    expect(next.plan.reasons).toEqual(['The new commits change SQL in src/feed.mts: high effort.'])
  })
})
