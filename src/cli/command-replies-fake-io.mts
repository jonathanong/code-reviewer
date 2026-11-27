import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { vi } from 'vitest'

import type { PrConversation, PrReview, ThreadComment } from '../review/context-query.mts'
import { reviewMarker } from '../review/render.mts'
import { HEAD, APP, fakeDeps } from '../run/fake-deps.mts'
import { runDirFor } from '../run/stage.mts'
import { repliesCommand } from './command-replies.mts'
import { approveReplies, type ApprovalRun } from './command-replies-approve.mts'

export const references = fileURLToPath(new URL('../../skills/review/references', import.meta.url))
export const FINDING = '**[blocking · congruence]** Option removed\n\nThe `--legacy` flag is gone.'
export const VALUES = { repo: ['acme/widgets'], pr: '4' }
export const PASSED: ApprovalRun = {
  approval: { passed: true },
  outcome: 'upheld',
  usage: null,
  ran: undefined,
  notes: [],
}

let root: string

export const rootDir = () => root

export function makeRoot() {
  root = mkdtempSync(join(tmpdir(), 'replies-'))
  mkdirSync(join(root, 'tmp'))
}

export function dropRoot() {
  rmSync(root, { recursive: true, force: true })
}

export const comment = (login: string, body: string, review = false): ThreadComment => ({
  author: { login },
  body,
  createdAt: 't',
  pullRequestReview: review ? { id: 'R1' } : null,
  url: 'https://example.test/c',
})

export function conversation(options: {
  verdict?: 'Request Changes' | 'Comment'
  severity?: string
  replies?: ThreadComment[]
  head?: string
  threads?: number
}): PrConversation {
  const review: PrReview = {
    id: 'R1',
    author: { login: APP },
    state: 'CHANGES_REQUESTED',
    body: reviewMarker(HEAD, options.verdict ?? 'Request Changes', 'high'),
    submittedAt: null,
    commit: { oid: HEAD },
  }
  const threads = Array.from({ length: options.threads ?? 1 }, (_, at) => ({
    id: `T${at + 1}`,
    isResolved: false,
    isOutdated: false,
    path: 'a.ts',
    line: 3,
    comments: {
      nodes: [
        comment(APP, FINDING.replace('blocking', options.severity ?? 'blocking'), true),
        ...(options.replies ?? [comment('dev', 'Intended.')]),
      ],
    },
  }))
  return {
    title: 'Title',
    author: { login: 'dev', __typename: 'User' },
    body: '',
    closingIssuesReferences: { nodes: [] },
    headRefOid: options.head ?? HEAD,
    baseRefOid: HEAD,
    baseRefName: 'main',
    additions: 1,
    deletions: 1,
    reviews: { nodes: [review] },
    reviewThreads: { nodes: threads },
    comments: { nodes: [] },
    commits: { nodes: [{ commit: { oid: HEAD, messageHeadline: 'c' } }] },
  }
}

export const model = (judgments: unknown) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.02,
    num_turns: 1,
    structured_output: { judgments },
  })

export type Setup = {
  pull?: PrConversation
  answer?: string
  labels?: string[]
  authMode?: 'app' | 'gh'
  replyFails?: boolean | 'string'
  resolveFails?: boolean
  noReport?: boolean
  rules?: string
  trusted?: string[]
  newHead?: string
  approval?: ApprovalRun
  /** The conversation read this many times is the one in which another review of the reviewer has landed. */
  landedAt?: number
  postFails?: boolean
}

export function setup(options: Setup = {}) {
  const fake = fakeDeps({
    stateDir: join(root, 'state'),
    labels: options.labels ?? [],
    ...(options.authMode === undefined ? {} : { authMode: options.authMode }),
    ...(options.postFails === true ? { postFails: true } : {}),
  })
  const { deps, io } = fake
  const reply = vi.fn(async (_thread: string, _body: string) => {
    if (options.replyFails === 'string') throw 'text failure'
    if (options.replyFails === true) throw new Error('reply denied')
  })
  let reads = 0
  const read = vi.fn(async () => {
    reads += 1
    const current = options.pull ?? conversation({})
    if (options.landedAt === undefined || reads < options.landedAt) return current
    const landed: PrReview = {
      id: 'R2',
      author: { login: APP },
      state: 'COMMENTED',
      body: '',
      submittedAt: null,
      commit: { oid: HEAD },
    }
    return { ...current, reviews: { nodes: [...current.reviews.nodes, landed] } }
  })
  deps.createAnswerIo.mockReturnValue({ conversation: read, reply })
  vi.mocked(approveReplies).mockResolvedValue(options.approval ?? PASSED)
  const graphql = vi.fn(async () => {
    if (options.resolveFails === true) throw new Error('resolve denied')
    return ''
  })
  deps.runner.mockReturnValue(graphql)
  deps.references.mockReturnValue(options.rules ?? references)
  deps.exec.mockResolvedValue(
    options.answer ??
      model([{ thread: 'T1', outcome: 'settled', why: 'Declared in the description.' }]),
  )
  deps.readFile.mockImplementation((path) => readFileSync(path, 'utf8'))
  deps.writeFile.mockImplementation((path, text) => writeFileSync(path, text))
  io.trustedAuthors.mockResolvedValue(new Set(options.trusted ?? [APP]))
  if (options.newHead !== undefined) {
    io.headSha.mockResolvedValue(options.newHead)
  }
  const runDir = runDirFor(deps, 'acme/widgets', 4, HEAD)
  if (options.noReport !== true) {
    mkdirSync(runDir, { recursive: true })
    const report = {
      version: 1,
      repo: 'acme/widgets',
      pr: 4,
      title: 'T',
      url: 'u',
      headSha: HEAD,
      mode: 'full',
      effort: 'high',
      reasons: [],
      skipReason: 'test',
      pillars: [],
      skillSelection: { selected: [] },
      verifier: null,
      usageByModel: [],
      verdict: null,
    }
    writeFileSync(join(runDir, 'report.json'), JSON.stringify(report))
  }
  const env = { env: {}, tmp: join(root, 'tmp'), git: vi.fn(), remote: vi.fn(), signals: undefined }
  return { ...fake, reply, graphql, runDir, read, env: env as never }
}

export const run = (fake: ReturnType<typeof setup>, values: object = VALUES) =>
  repliesCommand(values, fake.deps as never, fake.env)
