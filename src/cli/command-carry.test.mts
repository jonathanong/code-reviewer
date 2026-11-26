import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { runGit } from '../gh-cli/index.mts'
import type { LabelIo, ReviewIo } from '../review/index.mts'
import type { ListedReview } from '../review/github.mts'
import { NO_CONFIGS, parseRepoConfig } from '../review/rules/config.mts'
import { RUN_EXIT } from '../run/output.mts'
import type { TrackerIo } from '../tracker/types.mts'
import { carryCommand, defaultCarryEnv, type CarryEnv } from './command-carry.mts'
import { runReviewCommand } from './command.mts'
import type { ReviewDeps } from './deps.mts'

const IDENTITY = [
  '-c',
  'user.name=Test',
  '-c',
  'user.email=test@example.test',
  '-c',
  'commit.gpgsign=false',
]
const PULL = { repo: 'acme/widgets', pr: 4 }
const PR_ARGS = ['--repo', PULL.repo, '--pr', String(PULL.pr)]

let root: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'carry-cmd-'))
  mkdirSync(join(root, 'tmp'))
})
afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

const git = (cwd: string, ...args: string[]) => runGit(['-C', cwd, ...IDENTITY, ...args])
const rev = async (cwd: string, ref: string) => (await git(cwd, 'rev-parse', ref)).trim()

async function commitFile(cwd: string, name: string, content: string, message = name) {
  writeFileSync(join(cwd, name), content)
  await git(cwd, 'add', name)
  await git(cwd, 'commit', '-q', '-m', message)
}

/** Creates an origin repo with a base branch and a PR branch whose old head is returned. */
async function setupRepo() {
  const origin = join(root, 'origin')
  mkdirSync(origin)
  await git(origin, 'init', '-q', '-b', 'main')
  await commitFile(origin, 'shared.txt', 'one\ntwo\nthree\nfour\n')
  await git(origin, 'checkout', '-q', '-b', 'pr')
  await commitFile(origin, 'shared.txt', 'one\ntwo\nTHREE\nfour\n')
  await commitFile(origin, 'feature.txt', 'feature\n')
  const oldSha = await rev(origin, 'pr')
  await git(origin, 'checkout', '-q', 'main')
  await commitFile(origin, 'shared.txt', 'zero\none\ntwo\nthree\nfour\n')
  await commitFile(origin, 'unrelated.txt', 'main work\n')
  await git(origin, 'checkout', '-q', 'pr')
  return { origin, oldSha }
}

type MemoryTracker = TrackerIo & { files: Map<string, string> }

function memoryTracker(): MemoryTracker {
  const files = new Map<string, string>()
  return {
    dir: '/state',
    files,
    read: (path) => files.get(path),
    append: (path, text) => void files.set(path, `${files.get(path) ?? ''}${text}`),
    write: (path, text) => void files.set(path, text),
    now: () => new Date('2026-05-06T07:08:09.000Z'),
  }
}

const rowsOf = (tracker: MemoryTracker) =>
  (tracker.files.get('/state/reviews.jsonl') ?? '')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>)

type MockIo = { [K in keyof ReviewIo]: Mock<ReviewIo[K]> }

function fakeIo(headSha: string, initialReviews: ListedReview[]): MockIo {
  const posted: ListedReview[] = [...initialReviews]
  return {
    headSha: vi.fn(async () => headSha),
    diff: vi.fn(async () => ''),
    listFiles: vi.fn(async () => []),
    listReviews: vi.fn(async () => [...posted]),
    trustedAuthors: vi.fn(async () => new Set(['bot'])),
    pullAuthor: vi.fn(async () => 'dev'),
    standingReviews: vi.fn(async () => []),
    dismissReview: vi.fn(async () => undefined),
    hasApprovalLabel: vi.fn(async () => false),
    postReview: vi.fn(async (review) => {
      posted.push({
        id: 10 + posted.length,
        url: 'https://example.test/carried',
        body: review.body,
        author: 'bot',
      })
      return 'https://example.test/carried'
    }),
    addApprovalLabel: vi.fn(async () => undefined),
    removeApprovalLabel: vi.fn(async () => undefined),
  }
}

function approvedReview(sha: string, verdict = 'Approve', effort = 'high'): ListedReview {
  return {
    id: 1,
    url: 'https://example.test/old',
    body: `<!-- final-review sha=${sha} verdict=${verdict} effort=${effort} -->`,
    author: 'bot',
  }
}

function makeDeps(options: {
  baseSha: string
  headSha: string
  io: MockIo
  clone?: string
  tracker?: MemoryTracker
  checkRun?: boolean
}) {
  const tracker = options.tracker ?? memoryTracker()
  const labelIo: LabelIo = {
    labels: vi.fn(async () => ['final-review:in-progress']),
    add: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    heldHead: vi.fn(async () => undefined),
  }
  const ghRun = vi.fn(async (args: readonly string[]) => {
    if (args[0] === 'pr' && args[1] === 'view') {
      return JSON.stringify({ baseRefOid: options.baseSha, headRefOid: options.headSha })
    }
    return 'https://example.test/check\n'
  })
  const writeFile = vi.fn()
  const configs = options.checkRun
    ? {
        ...NO_CONFIGS,
        byOwner: new Map([
          ['acme', parseRepoConfig('{"checkRun":{"name":"Code review"}}', 'acme.json', 'owner')],
        ]),
      }
    : NO_CONFIGS
  const deps = {
    authMode: vi.fn(() => (options.checkRun ? 'app' : 'gh') as 'app' | 'gh'),
    checkInstallation: vi.fn(async () => undefined),
    authIdentity: vi.fn(async () => ({})),
    configs: vi.fn(() => configs),
    targetConfig: vi.fn(async () => ({ config: undefined, problems: [] })),
    createIo: vi.fn(() => options.io),
    createLabelIo: vi.fn(() => labelIo),
    createAnswerIo: vi.fn(() => ({ conversation: vi.fn(), reply: vi.fn() })),
    runner: vi.fn(() => ghRun),
    findClone: vi.fn(() => vi.fn(async () => options.clone)),
    tracker: vi.fn(() => tracker),
    writeFile,
  } as unknown as ReviewDeps
  return { deps, tracker, labelIo, ghRun, writeFile }
}

function testEnv(origin: string): CarryEnv {
  return { git: runGit, tmp: join(root, 'tmp'), remote: () => origin }
}

function capture() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true))
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true))
  return { out, err }
}

describe('carryCommand', () => {
  it('posts a carried approval when the change is identical after merging base', async () => {
    const { origin, oldSha } = await setupRepo()
    await git(origin, 'merge', '--no-ff', '--no-edit', 'main')
    const baseSha = await rev(origin, 'main')
    const headSha = await rev(origin, 'pr')
    const io = fakeIo(headSha, [approvedReview(oldSha)])
    const { deps, tracker, writeFile } = makeDeps({
      baseSha,
      headSha,
      io,
      clone: origin,
      checkRun: true,
    })

    const result = await carryCommand({ 'from-sha': oldSha }, PULL, deps, testEnv(origin))
    expect(result.exitCode).toBe(0)
    expect(io.postReview).toHaveBeenCalledOnce()
    const postedBody = io.postReview.mock.calls[0]?.[0]?.body ?? ''
    expect(postedBody).toContain(`<!-- final-review sha=${headSha} verdict=Approve effort=high -->`)
    expect(postedBody).toContain(oldSha.slice(0, 12))
    expect(postedBody).toContain('by diff')
    expect(io.addApprovalLabel).toHaveBeenCalledOnce()
    expect(writeFile).not.toHaveBeenCalled()
    expect(JSON.parse(result.text)).toMatchObject({
      verdict: 'Approve',
      event: 'APPROVE',
      label: 'added',
      carriedFrom: oldSha,
      lifecycle: { added: ['final-review:complete'], removed: ['final-review:in-progress'] },
      checkRun: { status: 'completed', url: 'https://example.test/check' },
    })
    expect(rowsOf(tracker)).toMatchObject([
      {
        repo: PULL.repo,
        pr: PULL.pr,
        head: headSha,
        state: 'posted',
        verdict: 'Approve',
        runDir: null,
      },
    ])
  })

  it('clones temporarily and posts when identical after a rebase without a local clone', async () => {
    const { origin, oldSha } = await setupRepo()
    // Keep oldSha reachable on origin via a tag so a fresh clone can fetch it.
    await git(origin, 'tag', 'old-head', oldSha)
    await git(origin, 'rebase', 'main')
    const baseSha = await rev(origin, 'main')
    const headSha = await rev(origin, 'pr')
    const io = fakeIo(headSha, [approvedReview(oldSha, 'Approve', 'medium')])
    const { deps } = makeDeps({ baseSha, headSha, io })

    const result = await carryCommand({ 'from-sha': oldSha }, PULL, deps, testEnv(origin))
    expect(result.exitCode).toBe(0)
    expect(io.postReview).toHaveBeenCalledOnce()
    expect(readdirSync(join(root, 'tmp'))).toEqual([])
  })

  it('prints the delta and exits 1 without posting when changes differ without --allow-delta', async () => {
    const { origin, oldSha } = await setupRepo()
    await git(origin, 'merge', '--no-ff', '--no-edit', 'main')
    await commitFile(origin, 'feature.txt', 'feature\nextra line\n')
    const baseSha = await rev(origin, 'main')
    const headSha = await rev(origin, 'pr')
    const io = fakeIo(headSha, [approvedReview(oldSha)])
    const { deps, tracker } = makeDeps({ baseSha, headSha, io, clone: origin })

    const result = await carryCommand({ 'from-sha': oldSha }, PULL, deps, testEnv(origin))
    expect(result.exitCode).toBe(1)
    expect(result.text).toContain('+1 -0 feature.txt')
    expect(result.text).toContain('+extra line')
    expect(io.postReview).not.toHaveBeenCalled()
    expect(io.addApprovalLabel).not.toHaveBeenCalled()
    expect(rowsOf(tracker)).toEqual([])
  })

  it('posts the carried approval listing differing files when --allow-delta is passed', async () => {
    const { origin, oldSha } = await setupRepo()
    await git(origin, 'merge', '--no-ff', '--no-edit', 'main')
    await commitFile(origin, 'feature.txt', 'feature\nnit fix\n')
    const baseSha = await rev(origin, 'main')
    const headSha = await rev(origin, 'pr')
    const io = fakeIo(headSha, [approvedReview(oldSha)])
    const { deps } = makeDeps({ baseSha, headSha, io, clone: origin })

    const result = await carryCommand(
      { 'from-sha': oldSha, 'allow-delta': true },
      PULL,
      deps,
      testEnv(origin),
    )
    expect(result.exitCode).toBe(0)
    expect(io.postReview).toHaveBeenCalledOnce()
    const postedBody = io.postReview.mock.calls[0]?.[0]?.body ?? ''
    expect(postedBody).toContain('`feature.txt`')
    expect(JSON.parse(result.text)).toMatchObject({
      verdict: 'Approve',
      carriedFrom: oldSha,
      deltaFiles: ['feature.txt'],
    })
  })

  it('prints what would be posted and posts nothing on --dry-run', async () => {
    const { origin, oldSha } = await setupRepo()
    await git(origin, 'merge', '--no-ff', '--no-edit', 'main')
    const baseSha = await rev(origin, 'main')
    const headSha = await rev(origin, 'pr')
    const io = fakeIo(headSha, [approvedReview(oldSha)])
    const { deps, tracker } = makeDeps({ baseSha, headSha, io, clone: origin })

    const result = await carryCommand(
      { 'from-sha': oldSha, 'dry-run': true },
      PULL,
      deps,
      testEnv(origin),
    )
    expect(result.exitCode).toBe(0)
    expect(io.postReview).not.toHaveBeenCalled()
    expect(io.addApprovalLabel).not.toHaveBeenCalled()
    expect(rowsOf(tracker)).toEqual([])
    const parsed = JSON.parse(result.text)
    expect(parsed).toMatchObject({ verdict: 'Approve', label: 'unchanged', carriedFrom: oldSha })
    expect(parsed.reviews[0].body).toContain(oldSha.slice(0, 12))
  })

  it('exits with the run noop code when the current head equals --from-sha', async () => {
    const sha = 'a'.repeat(40)
    const io = fakeIo(sha, [approvedReview(sha)])
    const { deps } = makeDeps({ baseSha: 'b'.repeat(40), headSha: sha, io })

    const result = await carryCommand({ 'from-sha': sha }, PULL, deps, testEnv('/unused'))
    expect(result.exitCode).toBe(RUN_EXIT.noop)
    expect(JSON.parse(result.text)).toMatchObject({
      outcome: 'noop',
      reason: expect.stringContaining('nothing to do'),
      fromSha: sha,
      headSha: sha,
    })
    expect(io.postReview).not.toHaveBeenCalled()
  })

  it('fails the same way post does when the head moved between reading it and posting', async () => {
    const { origin, oldSha } = await setupRepo()
    await git(origin, 'merge', '--no-ff', '--no-edit', 'main')
    const baseSha = await rev(origin, 'main')
    const headSha = await rev(origin, 'pr')
    const movedSha = 'f'.repeat(40)
    const io = fakeIo(movedSha, [approvedReview(oldSha)])
    const { deps, tracker } = makeDeps({ baseSha, headSha, io, clone: origin })

    await expect(carryCommand({ 'from-sha': oldSha }, PULL, deps, testEnv(origin))).rejects.toThrow(
      `Pull request head is ${movedSha}, not the reviewed ${headSha}`,
    )
    expect(io.postReview).not.toHaveBeenCalled()
    expect(rowsOf(tracker)).toEqual([])
  })

  it('cleans up the temporary checkout when cloning fails', async () => {
    const oldSha = 'a'.repeat(40)
    const headSha = 'b'.repeat(40)
    const io = fakeIo(headSha, [approvedReview(oldSha)])
    const { deps } = makeDeps({ baseSha: 'c'.repeat(40), headSha, io })

    await expect(
      carryCommand({ 'from-sha': oldSha }, PULL, deps, testEnv(join(root, 'nonexistent'))),
    ).rejects.toThrow()
    expect(existsSync(join(root, 'tmp'))).toBe(true)
    expect(readdirSync(join(root, 'tmp'))).toEqual([])
  })

  it('exposes the default environment pointing at github.com', () => {
    const env = defaultCarryEnv()
    expect(env.remote('acme/widgets')).toBe('https://github.com/acme/widgets.git')
  })
})

describe('runReviewCommand carry', () => {
  it('validates --from-sha and rejects unknown or non-approved OLD with exit code 2', async () => {
    const { err } = capture()
    const sha = 'a'.repeat(40)
    const head = 'b'.repeat(40)
    const io = fakeIo(head, [approvedReview(sha, 'Request-Changes')])
    const { deps } = makeDeps({ baseSha: 'c'.repeat(40), headSha: head, io })

    await expect(runReviewCommand(['carry', ...PR_ARGS], deps)).resolves.toBe(2)
    expect(err.join('')).toContain('carry needs --from-sha.')
    err.length = 0

    await expect(runReviewCommand(['carry', ...PR_ARGS, '--from-sha', 'abc'], deps)).resolves.toBe(
      2,
    )
    expect(err.join('')).toContain('--from-sha must be a full lowercase SHA.')
    err.length = 0

    await expect(runReviewCommand(['carry', ...PR_ARGS, '--from-sha', sha], deps)).resolves.toBe(2)
    expect(err.join('')).toContain('newest review is Request Changes, not Approve')
    err.length = 0

    const unknownIo = fakeIo(head, [])
    const { deps: unknownDeps } = makeDeps({
      baseSha: 'c'.repeat(40),
      headSha: head,
      io: unknownIo,
    })
    await expect(
      runReviewCommand(['carry', ...PR_ARGS, '--from-sha', sha], unknownDeps),
    ).resolves.toBe(2)
    expect(err.join('')).toContain('no posted Approve review found')
  })

  it('routes through runReviewCommand and prints output for noop and posted runs', async () => {
    const { out } = capture()
    const sha = 'a'.repeat(40)
    const io = fakeIo(sha, [approvedReview(sha)])
    const { deps } = makeDeps({ baseSha: 'b'.repeat(40), headSha: sha, io })

    await expect(runReviewCommand(['carry', ...PR_ARGS, '--from-sha', sha], deps)).resolves.toBe(
      RUN_EXIT.noop,
    )
    expect(JSON.parse(out.join(''))).toMatchObject({ outcome: 'noop' })
  })
})
