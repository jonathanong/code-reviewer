import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrConversation } from './context-query.mts'
import type { SinceDiff } from './plan.mts'
import { prepareReview } from './prepare.mts'
import type { PushInspection } from './push-types.mts'
import type { PrepareIo } from './prepare-io.mts'
import type { StackMember } from './stack.mts'
import { reviewMarker } from './render.mts'

const HEAD = 'a'.repeat(40)
const BASE = 'c'.repeat(40)
const OLD = 'b'.repeat(40)
const PATCH =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n'

function conversation(
  reviewedSha: string | null,
  author: PrConversation['author'] = { login: 'dev', __typename: 'User' },
  lines = 300,
): PrConversation {
  return {
    title: 'T',
    author,
    body: '',
    closingIssuesReferences: { nodes: [] },
    headRefOid: HEAD,
    baseRefOid: BASE,
    additions: lines,
    deletions: 0,
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

function inspection(rest: Partial<PushInspection>): PushInspection {
  return {
    kind: 'substantive',
    reason: 'The new commits are not all merges.',
    reviewedSha: OLD,
    headSha: HEAD,
    merges: [],
    mergesTotal: 0,
    problems: [],
    ...rest,
  }
}

type Overrides = {
  reviewed?: string | null
  since?: SinceDiff
  history?: string[]
  author?: PrConversation['author']
  lines?: number
  paths?: string[]
  push?: PushInspection
}

function fakeIo({
  reviewed = null,
  since,
  history = [],
  author,
  lines,
  paths,
  push,
}: Overrides = {}) {
  return {
    headSha: vi.fn(async () => HEAD),
    trusted: vi.fn(async () => new Set(['bot'])),
    diff: vi.fn(async () => PATCH),
    files: vi.fn(async () =>
      (paths ?? ['src/a.ts']).map((path, index) => ({
        path,
        lines: index === 0 ? (lines ?? 300) : 0,
      })),
    ),
    conversation: vi.fn(async () => conversation(reviewed, author, lines)),
    compare: vi.fn(async () => since ?? { status: 'ahead', paths: ['src/a.ts'], lines: 4 }),
    compareDiff: vi.fn(async () => PATCH),
    treeHead: vi.fn(async () => HEAD),
    push: vi.fn(async () => push ?? inspection({})),
    history: vi.fn(async () => history),
    ruleSources: vi.fn(async () => ({ related: [], missing: ['x: none'] })),
    stackInput: vi.fn(async () => ({ pr: 7, pulls: [] as StackMember[], defaultBranch: 'main' })),
    memberDiff: vi.fn(async () => PATCH),
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
    expect(summary).toMatchObject({ headSha: HEAD, baseSha: BASE, files: 1, lines: 300 })
    expect(summary.mode).toBe('full')
    expect(summary.plan.effort).toBe('high')
    expect(summary.written).toEqual([
      'diff.patch',
      'diff/INDEX.md',
      'context.md',
      'context.json',
      'plan.json',
      'rules/INDEX.md',
    ])
    expect(read('diff.patch').length).toBeGreaterThan(0)
    expect(read('diff/INDEX.md')).toContain('0001')
    expect(existsSync(join(out, 'diff', '0001.patch'))).toBe(true)
    expect(JSON.parse(read('context.json')).headSha).toBe(HEAD)
    expect(JSON.parse(read('plan.json'))).toMatchObject({ mode: 'full', effort: 'high' })
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
    expect(summary.plan).toMatchObject({ mode: 'light', effort: 'low', sinceSha: OLD })
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

  it('stages rule sources and reports them in the summary', async () => {
    const io = fakeIo()
    const summary = await prepareReview(io, { out, tree: '/tree', clones: '/clones' })
    expect(io.ruleSources).toHaveBeenCalledWith({ clones: '/clones', tree: '/tree', baseSha: BASE })
    expect(summary.written).toContain('rules/INDEX.md')
    expect(summary.rules).toMatchObject({
      related: [],
      consumers: [],
      missing: ['This repository: not staged (no --tree)', 'x: none'],
    })
    expect(read('rules/INDEX.md')).toContain('- x: none')
    await prepareReview(io, { out })
    expect(io.ruleSources).toHaveBeenLastCalledWith({ baseSha: BASE })
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

  it('plans a light review for a Dependabot pull request, reading the author from GitHub', async () => {
    const io = fakeIo({
      author: { login: 'dependabot', __typename: 'Bot' },
      paths: ['package.json'],
    })
    const summary = await prepareReview(io, { out })
    expect(summary.mode).toBe('light')
    expect(JSON.parse(read('plan.json'))).toMatchObject({ mode: 'light', effort: 'low' })
  })

  it('plans a skip for a lockfile-only Dependabot pull request and a review when forced', async () => {
    const author = { login: 'dependabot[bot]', __typename: 'Bot' }
    const skipIo = fakeIo({ author, paths: ['pnpm-lock.yaml'] })
    const skipped = await prepareReview(skipIo, { out })
    expect(skipped.mode).toBe('skip')
    expect(JSON.parse(read('plan.json'))).toMatchObject({ mode: 'skip', pillars: [] })
    const forced = await prepareReview(fakeIo({ author, paths: ['pnpm-lock.yaml'] }), {
      out,
      requested: 'high',
    })
    expect(forced.mode).toBe('full')
  })

  it('plans a light review for a small pull request and treats a deleted author as unknown', async () => {
    const summary = await prepareReview(fakeIo({ author: null, lines: 10 }), { out })
    expect(summary.mode).toBe('light')
  })

  it('counts only reviewable lines from the changed files', async () => {
    const io = fakeIo({ lines: 400, paths: ['pnpm-lock.yaml', 'src/a.ts'] })
    io.files.mockResolvedValue([
      { path: 'pnpm-lock.yaml', lines: 400 },
      { path: 'src/a.ts', lines: 30 },
    ])
    const summary = await prepareReview(io, { out })
    expect(summary).toMatchObject({ lines: 400, mode: 'light' })
    expect(summary.plan.reasons).toContain(
      'Small pull request (30 reviewable lines): light review.',
    )
  })

  it('writes stack.json, the later diffs, and a plan summary for a stacked pull request', async () => {
    const io = fakeIo()
    const pull = (number: number, headRef: string, baseRef: string) => ({
      number,
      title: `T${number}`,
      headRef,
      baseRef,
      headSha: HEAD,
    })
    io.stackInput.mockResolvedValue({
      pr: 7,
      pulls: [pull(7, 'b', 'main'), pull(8, 'c', 'b')],
      defaultBranch: 'main',
    })
    const summary = await prepareReview(io, { out })
    expect(summary.written).toEqual(
      expect.arrayContaining(['stack.json', join('stack', '8', 'INDEX.md')]),
    )
    expect(io.memberDiff).toHaveBeenCalledWith(
      expect.objectContaining({ number: 8 }),
      HEAD,
      undefined,
    )
    expect(summary.plan.stack).toMatchObject({ members: [7, 8], index: 0, rootIsDefault: true })
    expect(JSON.parse(read('plan.json')).stack.members).toEqual([7, 8])
    expect(summary.problems).toBeUndefined()
  })

  it('treats the pull request as flat and reports a problem when open pull requests fail', async () => {
    const io = fakeIo()
    io.stackInput.mockRejectedValue(new Error('rate limited'))
    const summary = await prepareReview(io, { out })
    expect(summary.problems).toHaveLength(1)
    expect(summary.plan.stack).toBeUndefined()
    expect(existsSync(join(out, 'stack.json'))).toBe(false)
    expect(summary.mode).toBe('full')
  })

  it('removes the stack of an earlier run in the same directory', async () => {
    mkdirSync(join(out, 'stack', '9'), { recursive: true })
    writeFileSync(join(out, 'stack.json'), '{}')
    const io = fakeIo()
    io.stackInput.mockRejectedValue(new Error('rate limited'))
    await prepareReview(io, { out })
    expect(existsSync(join(out, 'stack.json'))).toBe(false)
    expect(existsSync(join(out, 'stack'))).toBe(false)
  })

  describe('the push since the last review', () => {
    const CLEAN = {
      kind: 'base-merges-only' as const,
      reason: 'Every new commit merges the base.',
      merges: [{ sha: 'm'.repeat(40), resolution: '', truncated: false }],
      mergesTotal: 1,
      incoming: { from: BASE, to: HEAD, diff: PATCH },
    }

    it('does not ask git for a first review, an unmoved head, or without a checkout', async () => {
      const first = fakeIo()
      await prepareReview(first, { out, tree: '/tree' })
      const unmoved = fakeIo({ reviewed: HEAD })
      await prepareReview(unmoved, { out, tree: '/tree' })
      const flat = fakeIo({ reviewed: OLD })
      const summary = await prepareReview(flat, { out })
      for (const io of [first, unmoved, flat]) expect(io.push).not.toHaveBeenCalled()
      expect(summary.push).toBeUndefined()
      expect(existsSync(join(out, 'push.json'))).toBe(false)
    })

    it('routes a push of clean base merges to a light review of what came in', async () => {
      const io = fakeIo({ reviewed: OLD, push: inspection(CLEAN), lines: 4 })
      const summary = await prepareReview(io, { out, tree: '/tree' })
      expect(io.push).toHaveBeenCalledWith('/tree', {
        reviewedSha: OLD,
        headSha: HEAD,
        baseSha: BASE,
      })
      expect(summary.push).toMatchObject({ kind: 'base-merges-only', merges: 1, resolved: 0 })
      expect(summary.plan).toMatchObject({
        mode: 'light',
        push: 'base-merges-only',
        sinceSha: null,
      })
      expect(summary.plan.pillars.map(({ pillar }) => pillar)).toEqual(['correctness'])
      expect(summary.written).toEqual(
        expect.arrayContaining(['push.json', 'merges/INDEX.md', 'incoming/INDEX.md']),
      )
      expect(JSON.parse(read('push.json'))).toMatchObject({ kind: 'base-merges-only' })
      expect(existsSync(join(out, 'incoming', '0001.patch'))).toBe(true)
    })

    it('adds the security pillar for a resolution that touches a trigger path', async () => {
      const resolved = {
        ...CLEAN,
        merges: [
          {
            sha: 'm'.repeat(40),
            resolution:
              'diff --git a/src/auth.ts b/src/auth.ts\n--- a/src/auth.ts\n+++ b/src/auth.ts\n@@ -1 +1 @@\n-x\n+y\n',
            truncated: false,
          },
        ],
      }
      const io = fakeIo({ reviewed: OLD, push: inspection(resolved) })
      const summary = await prepareReview(io, { out, tree: '/tree' })
      expect(summary.push).toMatchObject({ resolved: 1, resolvedPaths: ['src/auth.ts'] })
      expect(summary.plan.pillars.map(({ pillar }) => pillar)).toEqual(['correctness', 'security'])
      expect(existsSync(join(out, 'merges', `${'m'.repeat(12)}.patch`))).toBe(true)
    })

    it('routes a same-change rebase to light and writes its range-diff', async () => {
      const io = fakeIo({
        reviewed: OLD,
        since: { status: 'diverged', paths: [], lines: 0 },
        push: inspection({
          kind: 'rebase-same-change',
          reason: 'same',
          rangeDiff: '1: a < -: b x\n',
          incoming: { from: BASE, to: HEAD, diff: PATCH },
        }),
      })
      const summary = await prepareReview(io, { out, tree: '/tree' })
      expect(summary.plan).toMatchObject({ mode: 'light', push: 'rebase-same-change' })
      expect(summary.written).toContain('range-diff.txt')
      expect(read('range-diff.txt')).toContain('a < -: b')
    })

    it('keeps a substantive push as it was, with its resolutions written', async () => {
      const io = fakeIo({
        reviewed: OLD,
        push: inspection({
          merges: [{ sha: 'm'.repeat(40), resolution: '', truncated: false }],
          mergesTotal: 1,
        }),
      })
      const plain = await prepareReview(fakeIo({ reviewed: OLD }), { out })
      const summary = await prepareReview(io, { out, tree: '/tree' })
      expect(summary.plan).toEqual(plain.plan)
      expect(summary.push).toMatchObject({ kind: 'substantive', merges: 1 })
      expect(summary.written).toContain('merges/INDEX.md')
    })

    it('reports what git could not answer as a problem', async () => {
      const io = fakeIo({ reviewed: OLD, push: inspection({ problems: ['no checkout'] }) })
      const summary = await prepareReview(io, { out, tree: '/tree' })
      expect(summary.problems).toEqual(['no checkout'])
    })

    it('removes the push of an earlier run in the same directory', async () => {
      await prepareReview(fakeIo({ reviewed: OLD, push: inspection(CLEAN) }), {
        out,
        tree: '/tree',
      })
      await prepareReview(fakeIo(), { out })
      for (const name of ['push.json', 'merges', 'incoming']) {
        expect(existsSync(join(out, name))).toBe(false)
      }
    })
  })
})
