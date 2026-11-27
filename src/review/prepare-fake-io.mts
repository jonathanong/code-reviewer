import { vi } from 'vitest'

import type { CarriedInspection } from './carried-file.mts'
import type { PrConversation } from './context-query.mts'
import type { SinceDiff } from './plan.mts'
import type { PrepareIo } from './prepare-io.mts'
import type { PushInspection } from './push-types.mts'
import { reviewMarker } from './render.mts'
import type { StackMember } from './stack.mts'

/** A fake GitHub and git for `prepareReview` tests: every read answers with a small valid value. */
export const HEAD = 'a'.repeat(40)
export const BASE = 'c'.repeat(40)
export const OLD = 'b'.repeat(40)
export const PATCH =
  'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n'

export function conversation(
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
    baseRefName: 'main',
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

const noneCarried: CarriedInspection = {
  commits: [],
  commitsInRange: 0,
  files: [],
  filesTotal: 0,
  defaultBranch: 'main',
  base: 'default',
  problems: [],
}

export function inspection(rest: Partial<PushInspection>): PushInspection {
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

export function fakeIo({
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
    carried: vi.fn<PrepareIo['carried']>().mockResolvedValue(noneCarried),
    mergedPull: vi.fn<PrepareIo['mergedPull']>(),
    self: { repo: 'o/r', number: 7 },
    linked: vi.fn<PrepareIo['linked']>().mockResolvedValue({ found: new Map(), problems: [] }),
    // Every commit is the pull request author's, made through GitHub and verified.
    pullCommits: vi.fn<PrepareIo['pullCommits']>(async () => ({
      commits: [
        { sha: HEAD, author: author?.login ?? 'dev', committer: 'web-flow', verified: true },
      ],
      complete: true,
    })),
    commitMessages: vi.fn<PrepareIo['commitMessages']>().mockResolvedValue([]),
    docGrep: vi.fn<PrepareIo['docGrep']>().mockResolvedValue(''),
    upgrades: {
      mergeBase: vi.fn<PrepareIo['upgrades']['mergeBase']>().mockResolvedValue(BASE),
      fileAt: vi.fn<PrepareIo['upgrades']['fileAt']>().mockResolvedValue(undefined),
      diffDirs: vi.fn<PrepareIo['upgrades']['diffDirs']>().mockResolvedValue(''),
      fetcher: vi.fn<PrepareIo['upgrades']['fetcher']>(),
    },
  } satisfies PrepareIo
}
