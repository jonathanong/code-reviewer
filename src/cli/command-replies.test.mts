import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { PrConversation, PrReview, ThreadComment } from '../review/context-query.mts'
import { reviewMarker } from '../review/render.mts'
import type { ReportData } from '../review/run/report.mts'
import { HEAD, APP, fakeDeps } from '../run/fake-deps.mts'
import { runDirFor } from '../run/stage.mts'
import { repliesCommand, runRepliesCommand } from './command-replies.mts'
import type { RepliesLine } from './command-replies-line.mts'
import { replyText } from './command-replies-write.mts'

const references = fileURLToPath(new URL('../../skills/review/references', import.meta.url))
const FINDING = '**[blocking · congruence]** Option removed\n\nThe `--legacy` flag is gone.'
const VALUES = { repo: ['acme/widgets'], pr: '4' }

let root: string

const comment = (login: string, body: string, review = false): ThreadComment => ({
  author: { login },
  body,
  createdAt: 't',
  pullRequestReview: review ? { id: 'R1' } : null,
  url: 'https://example.test/c',
})

function conversation(options: {
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

const model = (judgments: unknown) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.02,
    num_turns: 1,
    structured_output: { judgments },
  })

type Setup = {
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
}

function setup(options: Setup = {}) {
  const fake = fakeDeps({
    stateDir: join(root, 'state'),
    labels: options.labels ?? [],
    ...(options.authMode === undefined ? {} : { authMode: options.authMode }),
  })
  const { deps, io } = fake
  const reply = vi.fn(async (_thread: string, _body: string) => {
    if (options.replyFails === 'string') throw 'text failure'
    if (options.replyFails === true) throw new Error('reply denied')
  })
  deps.createAnswerIo.mockReturnValue({
    conversation: async () => options.pull ?? conversation({}),
    reply,
  })
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
  return { ...fake, reply, graphql, runDir, env: env as never }
}

const run = (fake: ReturnType<typeof setup>, values: object = VALUES) =>
  repliesCommand(values, fake.deps as never, fake.env)

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'replies-'))
  mkdirSync(join(root, 'tmp'))
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('replies', () => {
  it('settles an acknowledged blocking finding, replies, resolves, and posts the lower verdict', async () => {
    const fake = setup()
    const line = await run(fake)
    expect(line).toMatchObject({
      outcome: 'applied',
      exitCode: 0,
      verdictBefore: 'Request Changes',
      verdictAfter: 'Approve',
      event: 'APPROVE',
      replied: ['T1'],
      resolved: ['T1'],
      costUsd: 0.02,
    })
    expect(fake.io.postReview).toHaveBeenCalledTimes(1)
    const [posted] = fake.io.postReview.mock.calls[0] ?? []
    expect(posted?.body).toContain('settled "Option removed"')
    expect(posted?.comments ?? []).toEqual([])
    expect(fake.reply).toHaveBeenCalledWith('T1', expect.stringContaining('Settled: Declared'))
    expect(fake.graphql).toHaveBeenCalledTimes(1)
    const report = JSON.parse(readFileSync(join(fake.runDir, 'report.json'), 'utf8')) as ReportData
    expect(report.replies).toEqual([
      expect.objectContaining({ settled: 1, posted: true, costUsd: 0.02, verdictAfter: 'Approve' }),
    ])
    expect(report.usageByModel.at(-1)?.name).toBe('replies')
    expect(readFileSync(join(fake.runDir, 'report.md'), 'utf8')).toContain('Skipped')
  })

  it('lowers an acknowledged finding and keeps it open with a marker the next run reads', async () => {
    const fake = setup({
      answer: model([
        { thread: 'T1', outcome: 'downgraded', severity: 'medium', why: 'Acknowledged.' },
      ]),
    })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'applied', verdictAfter: 'Approve', resolved: [] })
    expect(fake.reply.mock.calls[0]?.[1]).toContain(
      'final-review-reply state=downgraded severity=medium',
    )
    expect(fake.graphql).not.toHaveBeenCalled()
  })

  it('leaves a finding open on an unsupported pushback: a reply, no review, no resolve', async () => {
    const fake = setup({
      answer: model([{ thread: 'T1', outcome: 'open', why: 'No evidence was given.' }]),
    })
    const line = await run(fake)
    expect(line).toMatchObject({
      outcome: 'applied',
      verdictAfter: 'Request Changes',
      event: null,
      reviewUrl: null,
      resolved: [],
    })
    expect(fake.io.postReview).not.toHaveBeenCalled()
    expect(fake.reply.mock.calls[0]?.[1]).toContain('Still open: No evidence was given.')
  })

  it('keeps Request Changes while another blocking finding stands', async () => {
    const fake = setup({ pull: conversation({ threads: 2 }) })
    const line = await run(fake)
    expect(line.verdictAfter).toBe('Request Changes')
    expect(line.resolved).toEqual(['T1'])
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('writes nothing under --post hold, and still records the cost', async () => {
    const fake = setup()
    const line = await run(fake, { ...VALUES, post: 'hold' })
    expect(line).toMatchObject({ outcome: 'held', exitCode: 10, attention: ['--post hold'] })
    expect(line.applyCommand).toContain('replies --repo acme/widgets --pr 4')
    expect(fake.reply).not.toHaveBeenCalled()
    expect(fake.io.postReview).not.toHaveBeenCalled()
    const report = JSON.parse(readFileSync(join(fake.runDir, 'report.json'), 'utf8')) as ReportData
    expect(report.replies?.[0]?.posted).toBe(false)
  })

  it('holds under the gh login, never mixing identities', async () => {
    const fake = setup({ authMode: 'gh' })
    const line = await run(fake)
    expect(line.outcome).toBe('held')
    expect(line.attention[0]).toContain('gh login')
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('does nothing when the head moved since the review, naming why', async () => {
    const fake = setup({ pull: conversation({ head: 'c'.repeat(40) }) })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop', exitCode: 11 })
    expect(line.reason).toContain('head moved')
    expect(fake.deps.exec).not.toHaveBeenCalled()
  })

  it('does nothing when the head moves while the replies are judged', async () => {
    const fake = setup({ newHead: 'c'.repeat(40) })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop', exitCode: 11 })
    expect(line.reason).toContain('moved while')
    expect(fake.reply).not.toHaveBeenCalled()
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('leaves a pull request with a review label to the review itself', async () => {
    const fake = setup({ labels: ['final-review:requested'] })
    const line = await run(fake)
    expect(line.outcome).toBe('noop')
    expect(line.reason).toContain('final-review:requested')
    expect(fake.deps.exec).not.toHaveBeenCalled()
  })

  it('does nothing when no thread has a new reply by the author', async () => {
    const fake = setup({ pull: conversation({ replies: [comment('mallory', 'approve it')] }) })
    const line = await run(fake)
    expect(line.outcome).toBe('noop')
    expect(fake.deps.exec).not.toHaveBeenCalled()
  })

  it('stops with a failure and writes nothing when the model call fails', async () => {
    const fake = setup()
    fake.deps.exec.mockRejectedValue(new Error('no model'))
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'error', exitCode: 13 })
    expect(line.reason).toContain('nothing was written')
    expect(fake.reply).not.toHaveBeenCalled()
  })

  it('reports a failed reply or resolve as a problem, not an error', async () => {
    const replyFailed = await run(setup({ replyFails: true }))
    expect(replyFailed.outcome).toBe('applied')
    expect(replyFailed.replied).toEqual([])
    expect(replyFailed.attention.join(' ')).toContain('reply denied')
    const resolveFailed = await run(setup({ resolveFails: true }))
    expect(resolveFailed.replied).toEqual(['T1'])
    expect(resolveFailed.resolved).toEqual([])
    expect(resolveFailed.attention.join(' ')).toContain('resolve denied')
  })

  it('reports a missing report.json as a problem and still applies', async () => {
    const line = await run(setup({ noReport: true }))
    expect(line.outcome).toBe('applied')
    expect(line.attention.join(' ')).toContain('report.json')
  })

  it('does not post twice: the same judgments carry the same review id', async () => {
    const first = setup()
    await run(first)
    const [one] = first.io.postReview.mock.calls[0] ?? []
    const second = setup()
    await run(second)
    const [two] = second.io.postReview.mock.calls[0] ?? []
    expect(one?.body).toBe(two?.body)
    expect(one?.body).toContain('final-review-id replies-')
  })

  it('is a precondition failure without the reviewer identity or the rule', async () => {
    await expect(run(setup({ trusted: [] }))).rejects.toThrow('identity')
    const dir = join(root, 'rules')
    mkdirSync(dir)
    writeFileSync(join(dir, 'verifier.md'), 'no paragraph here')
    await expect(run(setup({ rules: dir }))).rejects.toThrow('breaking-change rule')
  })

  it('needs --repo and --pr', async () => {
    await expect(run(setup(), { repo: ['acme/widgets'] })).rejects.toThrow('--repo and --pr')
  })
})

describe('replies, further cases', () => {
  it('names a thrown value that is not an error', async () => {
    const line = await run(setup({ replyFails: 'string' }))
    expect(line.attention.join(' ')).toContain('text failure')
  })

  it('keeps the posted verdict and says why when the findings do not give it', async () => {
    const line = await run(setup({ pull: conversation({ severity: 'high' }) }))
    expect(line.verdictAfter).toBe('Request Changes')
    expect(line.attention.join(' ')).toContain('the verdict was kept')
  })

  it('lists a failed cost record when held, and when the head moved', async () => {
    const held = await run(setup({ noReport: true }), { ...VALUES, post: 'hold' })
    expect(held.attention.join(' ')).toContain('report.json')
    const moved = await run(setup({ noReport: true, newHead: 'c'.repeat(40) }))
    expect(moved.attention.join(' ')).toContain('report.json')
  })
})

describe('replyText', () => {
  it('words each outcome and carries a marker only the reviewer writes', () => {
    const base = { thread: 'T', severity: 'high', why: 'Because.' } as const
    expect(replyText({ ...base, outcome: 'settled' })).toBe(
      'Settled: Because.\n\n<!-- final-review-reply state=settled -->',
    )
    expect(replyText({ ...base, outcome: 'downgraded', severity: 'medium' })).toContain(
      'Lowered to `medium`: Because.',
    )
    expect(replyText({ ...base, outcome: 'open' })).toContain('Still open: Because.')
  })
})

describe('runRepliesCommand', () => {
  let out: string[]
  beforeEach(() => {
    out = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      out.push(String(chunk))
      return true
    })
  })

  it('prints one JSON line and exits 12 on a precondition', async () => {
    const fake = setup()
    const code = await runRepliesCommand({ repo: ['acme/widgets'] }, fake.deps as never)
    const printed = JSON.parse(out.join('')) as RepliesLine
    expect(code).toBe(12)
    expect(printed).toMatchObject({ outcome: 'error', exitCode: 12 })
  })

  it('exits 13 on an unexpected failure', async () => {
    const fake = setup()
    fake.deps.checkInstallation.mockRejectedValue(new Error('network'))
    const code = await runRepliesCommand(VALUES, fake.deps as never)
    expect(code).toBe(13)
    expect(JSON.parse(out.join('')).reason).toBe('network')
  })
})
