import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../review/benchmark/cli.mts', () => ({
  runReviewBenchCli: vi.fn(async () => 5),
}))
vi.mock('../review/run/review.mts', () => ({
  runReview: vi.fn(async () => ({ ok: true, summary: { claimed: true } })),
}))
vi.mock('../review/benchmark/selection-cli.mts', () => ({
  runReviewSelectionBenchCli: vi.fn(async () => 4),
}))
vi.mock('../review/benchmark/verifier-cli.mts', () => ({
  runReviewVerifierBenchCli: vi.fn(async () => 6),
}))

import type { ReviewIo, LabelIo, PrepareIo } from '../review/index.mts'
import type { ListedReview } from '../review/github.mts'
import type { TrackerIo } from '../tracker/types.mts'
import { NO_CONFIGS, parseRepoConfig } from '../review/rules/config.mts'
import { runReview } from '../review/run/review.mts'
import { runReviewBenchCli } from '../review/benchmark/cli.mts'
import { runReviewSelectionBenchCli } from '../review/benchmark/selection-cli.mts'
import { runReviewVerifierBenchCli } from '../review/benchmark/verifier-cli.mts'
import { runReviewCommand, type ReviewDeps } from './command.mts'

const SHA = 'e'.repeat(40)

type MockIo = { [K in keyof ReviewIo]: Mock<ReviewIo[K]> }

function fakeIo(overrides: Partial<MockIo> = {}): MockIo {
  const posted: ListedReview[] = []
  return {
    headSha: vi.fn(async () => SHA),
    diff: vi.fn(async () => ''),
    listFiles: vi.fn(async () => []),
    listReviews: vi.fn(async () => [...posted]),
    trustedAuthors: vi.fn(async () => new Set(['bot'])),
    pullAuthor: vi.fn(async () => 'dev'),
    standingReviews: vi.fn(async () => []),
    dismissReview: vi.fn(async () => undefined),
    hasApprovalLabel: vi.fn(async () => true),
    postReview: vi.fn(async (review) => {
      posted.push({
        id: 7 + posted.length,
        url: 'https://example.test/r',
        body: review.body,
        author: 'bot',
      })
      return 'https://example.test/r'
    }),
    addApprovalLabel: vi.fn(async () => undefined),
    removeApprovalLabel: vi.fn(async () => undefined),
    ...overrides,
  }
}

type MockDeps = { [K in keyof ReviewDeps]: Mock<ReviewDeps[K]> }

const fakeLabelIo = (): LabelIo => ({
  labels: vi.fn(async () => ['final-review:in-progress']),
  add: vi.fn(async () => undefined),
  remove: vi.fn(async () => undefined),
  heldHead: vi.fn(async () => ({ head: undefined, placements: 0 })),
  labeledBy: vi.fn(async () => undefined),
})

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

function deps(io: ReviewIo, input = '{}', tracker = memoryTracker()): MockDeps {
  return {
    authMode: vi.fn(() => 'gh' as const),
    checkInstallation: vi.fn(async () => undefined),
    authIdentity: vi.fn(async () => ({})),
    configs: vi.fn(() => NO_CONFIGS),
    targetConfig: vi.fn(async () => ({ config: undefined, problems: [] })),
    createIo: vi.fn(() => io),
    createLabelIo: vi.fn(fakeLabelIo),
    createAnswerIo: vi.fn(() => ({ conversation: vi.fn(), reply: vi.fn() })),
    createPrepareIo: vi.fn(() => ({}) as PrepareIo),
    guideReader: vi.fn(() => vi.fn(async () => '')),
    runner: vi.fn(() => vi.fn(async () => '')),
    readFile: vi.fn(() => input),
    writeFile: vi.fn(),
    findClone: vi.fn(() => vi.fn(async () => undefined)),
    tracker: vi.fn(() => tracker),
    listPlugins: vi.fn(async () => [{ id: 'rules@m', version: '1.0.0' }]),
    pluginInfo: vi.fn(async () => ({ enabled: [], installs: [] })),
    exec: vi.fn(async () => ''),
    progress: vi.fn(),
    references: vi.fn(() => '/references'),
    runBench: vi.fn(async () => 7),
    runVerifierBench: vi.fn(async () => 8),
    runSelectionBench: vi.fn(async () => 9),
    runContextBench: vi.fn(async () => 3),
    runFocusBench: vi.fn(async () => 2),
  }
}

const PR = ['--repo', 'acme/widgets', '--pr', '4']

function capture() {
  const out: string[] = []
  const err: string[] = []
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    out.push(String(chunk))
    return true
  })
  vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    err.push(String(chunk))
    return true
  })
  return { out, err }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

describe('runReviewCommand', () => {
  it('routes models to its command, which names the supported harnesses on a bad one', async () => {
    const { err } = capture()
    await expect(runReviewCommand(['models', '--harness', 'claude'], deps(fakeIo()))).resolves.toBe(
      2,
    )
    expect(err.join('')).toContain('--harness opencode')
  })

  it('routes context to its command, which needs a repository, pull request and tree', async () => {
    const { err } = capture()
    await expect(runReviewCommand(['context', '--repo', 'o/r'], deps(fakeIo()))).resolves.toBe(2)
    expect(err.join('')).toContain('--repo, --pr and --tree')
  })

  it('forwards bench arguments without parsing them', async () => {
    const d = deps(fakeIo())
    await expect(runReviewCommand(['bench', '--cases', 'c'], d)).resolves.toBe(7)
    expect(d.runBench).toHaveBeenCalledWith(['--cases', 'c'])
    await expect(runReviewCommand(['bench-verifier', '--out', 'o'], d)).resolves.toBe(8)
    expect(d.runVerifierBench).toHaveBeenCalledWith(['--out', 'o'])
    await expect(runReviewCommand(['bench-selection', '--out', 'o'], d)).resolves.toBe(9)
    expect(d.runSelectionBench).toHaveBeenCalledWith(['--out', 'o'])
    expect(d.createIo).not.toHaveBeenCalled()
  })

  it('resolves the pull request target for loop subcommands that need one', async () => {
    const { out } = capture()
    const d = deps(fakeIo())
    await expect(runReviewCommand(['claim', ...PR, '--force'], d)).resolves.toBe(0)
    expect(d.createLabelIo).toHaveBeenCalledWith({ repo: 'acme/widgets', pr: 4 })
    expect(JSON.parse(out.join(''))).toMatchObject({ claimed: true })
  })

  it('posts a dry run and prints the full outcome', async () => {
    const { out } = capture()
    const d = deps(fakeIo(), JSON.stringify({ findings: [] }))
    await expect(
      runReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', 'f.json', '--dry-run'], d),
    ).resolves.toBe(0)
    expect(d.createIo).toHaveBeenCalledWith({ repo: 'acme/widgets', pr: 4 })
    expect(d.readFile).toHaveBeenCalledWith('f.json')
    expect(out.join('').trimEnd()).not.toContain('\n')
    const printed = JSON.parse(out.join(''))
    expect(printed).toMatchObject({ verdict: 'Approve', label: 'unchanged' })
    expect(Array.isArray(printed.reviews)).toBe(true)
  })

  it('uses the author prepare recorded instead of asking the host', async () => {
    const { out } = capture()
    const io = fakeIo()
    const run = JSON.stringify({ findings: [], author: 'bot', headSha: SHA })
    await runReviewCommand(
      ['post', ...PR, '--head-sha', SHA, '--input', 'f.json', '--dry-run'],
      deps(io, run),
    )
    expect(io.pullAuthor).not.toHaveBeenCalled()
    expect(JSON.parse(out.join(''))).toMatchObject({ event: 'COMMENT', downgraded: 'self-review' })
  })

  it('posts for real, completes the lifecycle, and prints the review count', async () => {
    const { out } = capture()
    const io = fakeIo()
    const d = deps(io, JSON.stringify({ findings: [] }))
    await expect(
      runReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', 'f.json'], d),
    ).resolves.toBe(0)
    expect(io.postReview).toHaveBeenCalledOnce()
    expect(JSON.parse(out.join(''))).toMatchObject({
      verdict: 'Approve',
      event: 'APPROVE',
      reviews: 1,
      urls: ['https://example.test/r'],
      label: 'added',
      lifecycle: { added: ['final-review:complete'], removed: ['final-review:in-progress'] },
    })
    expect(d.createLabelIo).toHaveBeenCalledWith({ repo: 'acme/widgets', pr: 4 })
  })

  it('records the posted review in the tracker', async () => {
    capture()
    const tracker = memoryTracker()
    const d = deps(fakeIo(), JSON.stringify({ findings: [] }), tracker)
    await runReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', 'f.json'], d)
    expect(rowsOf(tracker)).toMatchObject([
      {
        repo: 'acme/widgets',
        pr: 4,
        head: SHA,
        state: 'posted',
        verdict: 'Approve',
        reviewUrl: 'https://example.test/r',
        event: 'APPROVE',
        postedAt: '2026-05-06T07:08:09.000Z',
      },
    ])
  })

  it('does not record a dry run, and a tracker failure never fails a post', async () => {
    const { out } = capture()
    const tracker = memoryTracker()
    const dry = deps(fakeIo(), JSON.stringify({ findings: [] }), tracker)
    await runReviewCommand(
      ['post', ...PR, '--head-sha', SHA, '--input', 'f.json', '--dry-run'],
      dry,
    )
    expect(rowsOf(tracker)).toEqual([])
    out.length = 0
    const broken = deps(fakeIo(), JSON.stringify({ findings: [] }), {
      ...tracker,
      append: () => {
        throw new Error('disk full')
      },
    })
    await expect(
      runReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', 'f.json'], broken),
    ).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({
      verdict: 'Approve',
      trackerProblem: 'the tracker could not record this run: disk full',
    })
  })

  it('completes the configured check run when posting for real, and reports its failure', async () => {
    const { out } = capture()
    const run = vi.fn(async (_args: readonly string[]) => 'https://example.test/check\n')
    const io = fakeIo()
    io.headSha.mockResolvedValueOnce(SHA).mockResolvedValue('f'.repeat(40))
    const d = deps(io, JSON.stringify({ findings: [] }))
    d.authMode.mockReturnValue('app')
    d.configs.mockReturnValue({
      ...NO_CONFIGS,
      byOwner: new Map([
        ['acme', parseRepoConfig('{"checkRun":{"name":"Code review"}}', 'acme.json', 'owner')],
      ]),
    })
    d.runner.mockReturnValue(run)
    const argv = ['post', ...PR, '--head-sha', SHA, '--input', 'f.json']
    await expect(runReviewCommand(argv, d)).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({
      checkRun: { status: 'completed', url: 'https://example.test/check' },
    })
    expect(run.mock.calls.at(-1)?.[0]).toEqual(
      expect.arrayContaining([
        `head_sha=${SHA}`,
        'repos/acme/widgets/check-runs',
        'conclusion=success',
        'output[title]=Approve',
        'output[summary]=https://example.test/r',
      ]),
    )
    expect(io.headSha).toHaveBeenCalledOnce()
    out.length = 0
    run.mockRejectedValue(new Error('403'))
    io.headSha.mockResolvedValueOnce(SHA)
    io.listReviews.mockResolvedValueOnce([])
    await expect(runReviewCommand(argv, d)).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({
      label: 'added',
      checkRun: { status: 'failed', error: '403' },
    })
  })

  it('prints settings and skips a pull request', async () => {
    const { out } = capture()
    const d = deps(fakeIo())
    await expect(runReviewCommand(['settings', '--owner', 'acme'], d)).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ scope: 'acme', checkRun: null })
    out.length = 0
    await expect(runReviewCommand(['skip', ...PR, '--reason', 'generated only'], d)).resolves.toBe(
      0,
    )
    expect(JSON.parse(out.join(''))).toMatchObject({ skipped: true, reason: 'generated only' })
  })

  it('runs loop subcommands without a pull request target', async () => {
    const { out } = capture()
    const d = deps(fakeIo())
    await expect(runReviewCommand(['auth'], d)).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toEqual({ mode: 'gh' })
    expect(d.createIo).not.toHaveBeenCalled()
  })

  it('requires --head-sha and --input for post', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    await expect(runReviewCommand(['post', ...PR, '--input', 'f'], d)).resolves.toBe(2)
    await expect(runReviewCommand(['post', ...PR, '--head-sha', SHA], d)).resolves.toBe(2)
    expect(err.join('')).toBe(
      'code-reviewer: post needs --head-sha and --input.\ncode-reviewer: post needs --head-sha and --input.\n',
    )
  })

  it('prints the numbered diff', async () => {
    const { out } = capture()
    const io = fakeIo({ diff: vi.fn(async () => '@@ -1 +1 @@\n+x') })
    await expect(runReviewCommand(['diff', ...PR], deps(io))).resolves.toBe(0)
    expect(out.join('')).toBe('@@ -1 +1 @@\n            1 +x')
  })

  it('revokes the approval label', async () => {
    const { out } = capture()
    const io = fakeIo()
    await expect(runReviewCommand(['revoke', ...PR], deps(io))).resolves.toBe(0)
    expect(io.removeApprovalLabel).toHaveBeenCalledOnce()
    expect(JSON.parse(out.join(''))).toEqual({ removed: true })
  })

  it('lists plugins and exits 1 when a required one is missing', async () => {
    const { out } = capture()
    const d = deps(fakeIo())
    await expect(runReviewCommand(['plugins'], d)).resolves.toBe(0)
    await expect(runReviewCommand(['plugins', '--require', 'rules'], d)).resolves.toBe(0)
    out.length = 0
    await expect(
      runReviewCommand(['plugins', '--require', 'rules', '--require', 'db'], d),
    ).resolves.toBe(1)
    expect(JSON.parse(out.join(''))).toEqual({ plugins: ['rules@m 1.0.0'], missing: ['db'] })
    expect(d.createIo).not.toHaveBeenCalled()
  })

  it('reports usage and validation errors with exit code 2', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    await expect(runReviewCommand(['status', '--pr', '4'], d)).resolves.toBe(2)
    await expect(runReviewCommand(['status', '--repo', 'a/b'], d)).resolves.toBe(2)
    await expect(runReviewCommand([], d)).resolves.toBe(2)
    await expect(runReviewCommand(['wat', ...PR], d)).resolves.toBe(2)
    await expect(runReviewCommand(['status', '--bogus'], d)).resolves.toBe(2)
    expect(err.join('')).toContain('code-reviewer: --repo and --pr are required.')
    expect(err.join('')).toContain(
      'code-reviewer: give a subcommand: post, carry, diff, revoke, status, auth, settings, queue, claim, abort, skip, prepare, review, run, context, report, resolve, plugins, tracker, explain, outcomes, issues, doctor, models, bench, bench-verifier, bench-selection, bench-context, or bench-focus.',
    )
  })

  it('prints the review summary and exits 1 when the review failed', async () => {
    const { out } = capture()
    const args = ['review', ...PR, '--out', 'o', '--tree', 't']
    await expect(runReviewCommand(args, deps(fakeIo()))).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toEqual({ claimed: true })
    vi.mocked(runReview).mockResolvedValueOnce({ ok: false, summary: { error: 'x' } })
    await expect(runReviewCommand(args, deps(fakeIo()))).resolves.toBe(1)
  })

  it('records the review run in the tracker and reports a tracker failure beside the summary', async () => {
    const { out } = capture()
    const args = ['review', ...PR, '--out', 'o', '--tree', 't']
    const tracker = memoryTracker()
    vi.mocked(runReview).mockResolvedValueOnce({
      ok: false,
      summary: { claimed: true, error: 'every pillar failed' },
    })
    await runReviewCommand(args, deps(fakeIo(), '{}', tracker))
    expect(rowsOf(tracker)).toMatchObject([
      {
        repo: 'acme/widgets',
        pr: 4,
        state: 'failed',
        reason: 'every pillar failed',
        startedAt: '2026-05-06T07:08:09.000Z',
        runDir: resolve('o'),
      },
    ])
    out.length = 0
    const broken = {
      ...tracker,
      append: () => {
        throw new Error('disk full')
      },
    }
    await runReviewCommand(args, deps(fakeIo(), '{}', broken))
    expect(JSON.parse(out.join(''))).toEqual({
      claimed: true,
      trackerProblem: 'the tracker could not record this run: disk full',
    })
  })

  it('re-renders a report from report.json and exits 2 for a bad one', async () => {
    const { out, err } = capture()
    const dir = mkdtempSync(join(tmpdir(), 'cmd-report-'))
    try {
      writeFileSync(join(dir, 'report.json'), '{"version":2}')
      await expect(runReviewCommand(['report', '--out', dir], deps(fakeIo()))).resolves.toBe(2)
      expect(err.join('')).toContain('not a version 1 report')
      writeFileSync(
        join(dir, 'report.json'),
        JSON.stringify({
          version: 1,
          repo: 'a/b',
          pr: 1,
          title: 'T',
          url: 'u',
          headSha: 'abcdef0',
          mode: 'skip',
          effort: 'low',
          reasons: [],
          skipReason: 'Nope.',
          verdict: null,
          skipped: [],
          skillSelection: { selected: [], available: 0, usage: null },
          pillars: [],
          verifier: null,
          findings: [],
          summary: '',
          pullRequestSummary: '',
        }),
      )
      await expect(runReviewCommand(['report', '--out', dir], deps(fakeIo()))).resolves.toBe(0)
      expect(JSON.parse(out.join('')).report).toBe(join(dir, 'report.md'))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('prints usage for help', async () => {
    const { out } = capture()
    await expect(runReviewCommand(['help'], deps(fakeIo()))).resolves.toBe(0)
    await expect(runReviewCommand(['--help'], deps(fakeIo()))).resolves.toBe(0)
    expect(out.join('')).toContain('code-reviewer post --repo')
  })

  it('stringifies non-Error failures', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    d.createIo.mockImplementation(() => {
      throw 'not an error'
    })
    await expect(runReviewCommand(['status', ...PR], d)).resolves.toBe(2)
    expect(err.join('')).toBe('code-reviewer: not an error\n')
  })
})

describe('runReviewCommand default dependencies', () => {
  it('reads input from disk, builds a gh io, and delegates bench', async () => {
    const { err } = capture()
    // No App on this machine: the real auth is the gh login, so no network is touched.
    vi.stubEnv('XDG_CONFIG_HOME', '/nonexistent/code-reviewer')
    vi.stubEnv('CODE_REVIEWER_APP_ID', '')
    const dir = mkdtempSync(join(tmpdir(), 'review-cmd-'))
    try {
      const file = join(dir, 'findings.json')
      writeFileSync(file, '{"findings": 3}')
      await expect(
        runReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', file]),
      ).resolves.toBe(2)
      expect(err.join('')).toContain('findings must be an array.')
      // A malformed repo is rejected by the default gh io factory without running gh.
      await expect(runReviewCommand(['status', '--repo', 'bad', '--pr', '1'])).resolves.toBe(2)
      expect(err.join('')).toContain('--repo must be owner/name.')
      await expect(runReviewCommand(['bench', '--x'])).resolves.toBe(5)
      expect(runReviewBenchCli).toHaveBeenCalledWith(['--x'])
      await expect(runReviewCommand(['bench-verifier', '--y'])).resolves.toBe(6)
      expect(runReviewVerifierBenchCli).toHaveBeenCalledWith(['--y'])
      await expect(runReviewCommand(['bench-selection', '--z'])).resolves.toBe(4)
      expect(runReviewSelectionBenchCli).toHaveBeenCalledWith(['--z'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
