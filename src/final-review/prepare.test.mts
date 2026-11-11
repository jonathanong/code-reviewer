import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrConversation } from './context-query.mts'
import type { SinceDiff } from './plan.mts'
import { prepareReview } from './prepare.mts'
import type { PrepareIo } from './prepare-io.mts'
import { reviewMarker } from './render.mts'

const HEAD = 'a'.repeat(40)
const BASE = 'c'.repeat(40)
const OLD = 'b'.repeat(40)
const PATCH =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n'

function conversation(reviewedSha: string | null): PrConversation {
  return {
    title: 'T',
    body: '',
    closingIssuesReferences: { nodes: [] },
    headRefOid: HEAD,
    baseRefOid: BASE,
    additions: 10,
    deletions: 10,
    reviews: {
      nodes:
        reviewedSha === null
          ? []
          : [
              {
                id: 'r1',
                author: { login: 'bot' },
                state: 'COMMENTED',
                body: reviewMarker(reviewedSha, 'Comment', 'high'),
                submittedAt: null,
                commit: { oid: reviewedSha },
              },
            ],
    },
    reviewThreads: { nodes: [] },
    comments: { nodes: [] },
    commits: { nodes: [] },
  }
}

type Overrides = { reviewed?: string | null; since?: SinceDiff; history?: string[] }

function fakeIo({ reviewed = null, since, history = [] }: Overrides = {}) {
  return {
    headSha: vi.fn(async () => HEAD),
    trusted: vi.fn(async () => new Set(['bot'])),
    diff: vi.fn(async () => PATCH),
    paths: vi.fn(async () => ['src/a.ts']),
    conversation: vi.fn(async () => conversation(reviewed)),
    compare: vi.fn(async () => since ?? { status: 'ahead', paths: ['src/a.ts'], lines: 4 }),
    compareDiff: vi.fn(async () => PATCH),
    treeHead: vi.fn(async () => HEAD),
    history: vi.fn(async () => history),
  } satisfies PrepareIo
}

let out: string
beforeEach(() => {
  out = mkdtempSync(join(tmpdir(), 'prepare-'))
})
afterEach(() => rmSync(out, { recursive: true, force: true }))

const read = (name: string) => readFileSync(join(out, name), 'utf8')

describe('prepareReview', () => {
  it('writes the first-review files with the default writer', async () => {
    const io = fakeIo()
    const summary = await prepareReview(io, { out })
    expect(summary).toMatchObject({ headSha: HEAD, baseSha: BASE, files: 1, lines: 20 })
    expect(summary.plan.effort).toBe('high')
    expect(summary.written).toEqual([
      'diff.patch',
      'diff/INDEX.md',
      'context.md',
      'context.json',
      'plan.json',
    ])
    expect(read('diff.patch').length).toBeGreaterThan(0)
    expect(read('diff/INDEX.md')).toContain('0001')
    expect(existsSync(join(out, 'diff', '0001.patch'))).toBe(true)
    expect(JSON.parse(read('context.json')).headSha).toBe(HEAD)
    expect(JSON.parse(read('plan.json')).effort).toBe('high')
    expect(read('context.md').length).toBeGreaterThan(0)
    expect(io.compare).not.toHaveBeenCalled()
    expect(io.history).not.toHaveBeenCalled()
  })

  it('uses an injected writer', async () => {
    const write = vi.fn()
    await prepareReview(fakeIo(), { out }, write)
    expect(write).toHaveBeenCalledWith(join(out, 'plan.json'), expect.any(String))
  })

  it('writes the since diff for an ahead follow-up', async () => {
    const io = fakeIo({ reviewed: OLD })
    const summary = await prepareReview(io, { out })
    expect(io.compare).toHaveBeenCalledWith(OLD, HEAD)
    expect(io.compareDiff).toHaveBeenCalledWith(OLD, HEAD)
    expect(summary.written).toContain('since.patch')
    expect(summary.written).toContain('since/INDEX.md')
    expect(existsSync(join(out, 'since', 'INDEX.md'))).toBe(true)
    expect(existsSync(join(out, 'since.patch'))).toBe(true)
    expect(summary.plan).toMatchObject({ effort: 'low', sinceSha: OLD })
  })

  it('skips the since diff when history was rewritten', async () => {
    const io = fakeIo({ reviewed: OLD, since: { status: 'diverged', paths: [], lines: 0 } })
    const summary = await prepareReview(io, { out })
    expect(io.compareDiff).not.toHaveBeenCalled()
    expect(summary.plan.effort).toBe('high')
    expect(existsSync(join(out, 'since.patch'))).toBe(false)
  })

  it('does not compare when the head was already reviewed', async () => {
    const io = fakeIo({ reviewed: HEAD })
    const summary = await prepareReview(io, { out })
    expect(io.compare).not.toHaveBeenCalled()
    expect(summary.plan.upToDate).toBe(true)
  })

  it('checks history when a tree is given', async () => {
    const io = fakeIo({ history: ['Revert "x"', 'feat: y'] })
    const summary = await prepareReview(io, { out, tree: '/tree' })
    expect(io.history).toHaveBeenCalledWith('/tree', BASE, ['src/a.ts'])
    expect(summary.plan.pillars.map((p) => p.pillar)).toContain('history')
  })

  it('rejects a tree that is not at the head', async () => {
    const io = fakeIo()
    io.treeHead.mockResolvedValue(OLD)
    await expect(prepareReview(io, { out, tree: '/tree' })).rejects.toThrow(
      `--tree /tree is at ${OLD}, not the pull request head ${HEAD}`,
    )
    expect(io.history).not.toHaveBeenCalled()
  })

  it('passes the requested effort through', async () => {
    const summary = await prepareReview(fakeIo(), { out, requested: 'medium' })
    expect(summary.plan.effort).toBe('medium')
  })

  it('plans without history when the base is missing from the tree', async () => {
    const io = fakeIo()
    io.history.mockResolvedValue(undefined as never)
    const summary = await prepareReview(io, { out, tree: '/tree' })
    expect(summary.plan.skipped).toContainEqual({
      pillar: 'history',
      reason: 'History not checked.',
    })
  })
})
