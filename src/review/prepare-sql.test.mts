import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEFAULT_PLAN_VALUES } from './plan-settings.mts'
import { prepareReview } from './prepare.mts'
import { OLD, fakeIo } from './prepare-fake-io.mts'

let out: string
let tree: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'prepare-sql-'))
  tree = mkdtempSync(join(tmpdir(), 'prepare-sql-tree-'))
  mkdirSync(join(tree, 'src'))
  writeFileSync(join(tree, 'src/feed.mts'), 'y\n')
})
afterEach(() => {
  rmSync(out, { recursive: true, force: true })
  rmSync(tree, { recursive: true, force: true })
})

const PATCH =
  'diff --git a/src/feed.mts b/src/feed.mts\n--- a/src/feed.mts\n+++ b/src/feed.mts\n@@ -1 +1 @@\n-x\n+y\n'
const hit = () =>
  JSON.stringify([
    { file: join(tree, 'src/feed.mts'), range: { start: { line: 0 }, end: { line: 0 } } },
  ])
const options = () => ({ sqlRules: '/rules/sgconfig.yml', tree })

function io(extra: Parameters<typeof fakeIo>[0] = {}) {
  const fake = fakeIo({ lines: 5, paths: ['src/feed.mts'], ...extra })
  fake.diff.mockResolvedValue(PATCH)
  fake.compareDiff.mockResolvedValue(PATCH)
  fake.treeHead.mockResolvedValue('a'.repeat(40))
  fake.astGrep.mockResolvedValue(hit())
  return fake
}

describe('prepareReview with SQL in source', () => {
  it('plans a full review for a small pull request whose changed lines ast-grep calls SQL', async () => {
    const summary = await prepareReview(io(), { out, ...options() })
    expect(summary.plan).toMatchObject({ mode: 'full', effort: 'high' })
    expect(summary.plan.reasons).toEqual([
      'The pull request changes SQL in src/feed.mts: high effort.',
    ])
  })

  it('stays light with plan.sqlInCode off, without running ast-grep', async () => {
    const fake = io()
    const values = { ...DEFAULT_PLAN_VALUES, sqlInCode: false }
    const summary = await prepareReview(fake, { out, ...options(), values })
    expect(summary.mode).toBe('light')
    expect(fake.astGrep).not.toHaveBeenCalled()
  })

  it('stays light and says so when ast-grep is not installed', async () => {
    const fake = io()
    fake.astGrep.mockRejectedValue(Object.assign(new Error('spawn'), { code: 'ENOENT' }))
    const summary = await prepareReview(fake, { out, ...options() })
    expect(summary.mode).toBe('light')
    expect(summary.plan.reasons).toContain(
      'SQL detection was skipped because ast-grep was not found.',
    )
  })

  it('does not run the check without a rules path', async () => {
    const fake = io()
    expect((await prepareReview(fake, { out })).mode).toBe('light')
    expect(fake.astGrep).not.toHaveBeenCalled()
  })

  it('escalates a follow-up whose new commits change SQL in source', async () => {
    const summary = await prepareReview(io({ reviewed: OLD, lines: 200 }), { out, ...options() })
    expect(summary.plan.reasons).toEqual([
      'The new commits change SQL in src/feed.mts: high effort.',
    ])
  })
})
