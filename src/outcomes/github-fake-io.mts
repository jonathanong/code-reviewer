import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'

import { createTrackerIo } from '../tracker/io.mts'
import { appendRow } from '../tracker/store.mts'
import type { TrackerIo, TrackerRow } from '../tracker/types.mts'
import type { OutcomesIo } from './types.mts'

type Json = Record<string, unknown>

export const NOW = new Date('2026-06-10T12:00:00.000Z')
export const HEAD = 'b'.repeat(40)
export const OID = 'a'.repeat(40)

const groups = (up = 0, down = 0, other: Record<string, number> = {}) => [
  { content: 'THUMBS_UP', reactors: { totalCount: up } },
  { content: 'THUMBS_DOWN', reactors: { totalCount: down } },
  ...Object.entries(other).map(([content, totalCount]) => ({ content, reactors: { totalCount } })),
]

export const BODY = (rule?: string) =>
  `**[high · rules]** Missing check\n\nDetail${rule === undefined ? '' : ` per \`${rule}\``}`

export function review(id: number, over: Json = {}): Json {
  return {
    databaseId: id,
    state: 'COMMENTED',
    body: '',
    url: `https://example.test/review/${id}`,
    author: { login: 'reviewer[bot]' },
    reactionGroups: groups(),
    ...over,
  }
}

type ThreadOptions = {
  id: number
  review?: number
  body?: string
  resolved?: boolean
  outdated?: boolean
  replyBy?: string
  line?: number | null
  startLine?: number | null
  oid?: string | null
  up?: number
  down?: number
  other?: Record<string, number>
}

export function thread(options: ThreadOptions): Json {
  const first: Json = {
    databaseId: options.id,
    body: options.body ?? BODY(),
    url: `https://example.test/comment/${options.id}`,
    path: 'src/a.ts',
    line: null,
    originalLine: options.line === undefined ? 14 : options.line,
    originalStartLine: options.startLine === undefined ? 12 : options.startLine,
    originalCommit: options.oid === null ? null : { oid: options.oid ?? OID },
    author: { login: 'reviewer[bot]' },
    reactionGroups: groups(options.up, options.down, options.other),
    pullRequestReview: { databaseId: options.review ?? 100 },
  }
  const reply: Json = {
    ...first,
    databaseId: options.id + 1000,
    author: { login: options.replyBy },
    reactionGroups: [],
  }
  return {
    isResolved: options.resolved === true,
    isOutdated: options.outdated === true,
    comments: { nodes: options.replyBy === undefined ? [first] : [first, reply] },
  }
}

export type FakePull = {
  state?: string
  reviews?: Json[]
  threads?: Json[]
  /** Nodes per page, so a test can paginate. */
  pageSize?: number
  /** Raises on every call for this pull request. */
  fails?: boolean
}

/** A `gh` runner answering GraphQL reads from `pulls` by number, and the compare API from `compare`. */
export function fakeGh(pulls: Record<number, FakePull>, compare: Json | Error = { files: [] }) {
  const calls: string[][] = []
  const run = vi.fn(async (args: string[]) => {
    calls.push(args)
    if (args[1]?.startsWith('repos/')) {
      if (compare instanceof Error) throw compare
      return JSON.stringify(compare)
    }
    const query = String(args.find((arg) => arg.startsWith('query=')))
    const number = Number(args[args.indexOf('-F') + 1]?.replace('number=', ''))
    const after = Number(args.find((arg) => arg.startsWith('after='))?.slice(6) ?? 0)
    const pull = pulls[number] as FakePull
    if (pull.fails === true) throw new Error('HTTP 502')
    const field = query.includes('reviewThreads') ? 'reviewThreads' : 'reviews'
    const all = (field === 'reviews' ? pull.reviews : pull.threads) ?? []
    const size = pull.pageSize ?? 100
    const nodes = all.slice(after, after + size)
    const more = after + size < all.length
    const connection = { nodes, pageInfo: { hasNextPage: more, endCursor: String(after + size) } }
    return JSON.stringify({
      data: {
        repository: {
          pullRequest: { state: pull.state ?? 'OPEN', headRefOid: HEAD, [field]: connection },
        },
      },
    })
  })
  return { run, calls }
}

export function io(
  over: Partial<OutcomesIo> = {},
  gh = fakeGh({}),
): OutcomesIo & { gh: typeof gh } {
  return {
    run: () => gh.run,
    git: vi.fn(async () => `${HEAD}\n`),
    findClone: async () => '/clones/widgets',
    ...over,
    gh,
  }
}

export function memoryTracker(): TrackerIo {
  const dir = join(mkdtempSync(join(tmpdir(), 'outcomes-')), 'state')
  return { ...createTrackerIo({ CODE_REVIEWER_STATE_DIR: dir }), now: () => NOW }
}

export function posted(over: Partial<TrackerRow> = {}): TrackerRow {
  return {
    repo: 'acme/widgets',
    pr: 7,
    head: HEAD,
    state: 'posted',
    title: null,
    author: null,
    mode: null,
    verdict: null,
    counts: null,
    questions: null,
    costUsd: null,
    startedAt: null,
    finishedAt: null,
    reason: null,
    reviewUrl: null,
    reviewId: 100,
    event: null,
    downgraded: null,
    postedAt: '2026-06-09T12:00:00.000Z',
    runDir: null,
    ...over,
  }
}

export function seeded(...rows: TrackerRow[]): TrackerIo {
  const tracker = memoryTracker()
  for (const row of rows.length === 0 ? [posted()] : rows) appendRow(tracker, row)
  return tracker
}
