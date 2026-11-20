import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
import { NO_CONFIGS, parseRepoConfig } from '../review/rules/config.mts'
import { runReview } from '../review/run/review.mts'
import { runReviewBenchCli } from '../review/benchmark/cli.mts'
import { runReviewSelectionBenchCli } from '../review/benchmark/selection-cli.mts'
import { runReviewVerifierBenchCli } from '../review/benchmark/verifier-cli.mts'
import { runReviewCommand, type ReviewDeps } from './command.mts'

const SHA = 'e'.repeat(40)

type MockIo = { [K in keyof ReviewIo]: Mock<ReviewIo[K]> }

function fakeIo(overrides: Partial<MockIo> = {}): MockIo {
  return {
    headSha: vi.fn(async () => SHA),
    diff: vi.fn(async () => ''),
    listFiles: vi.fn(async () => []),
    listReviews: vi.fn(async () => []),
    trustedAuthors: vi.fn(async () => new Set(['bot'])),
    hasApprovalLabel: vi.fn(async () => true),
    postReview: vi.fn(async () => 'https://example.test/r'),
    addApprovalLabel: vi.fn(async () => undefined),
    removeApprovalLabel: vi.fn(async () => undefined),
    ...overrides,
  }
}

type MockDeps = { [K in keyof ReviewDeps]: Mock<ReviewDeps[K]> }

function fakeLabelIo(): LabelIo {
  return {
    labels: vi.fn(async () => ['final-review:in-progress']),
    add: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  }
}

function deps(io: ReviewIo, input = '{}'): MockDeps {
  return {
    authMode: vi.fn(() => 'gh' as const),
    configs: vi.fn(() => NO_CONFIGS),
    targetConfig: vi.fn(async () => ({ config: undefined, problems: [] })),
    createIo: vi.fn(() => io),
    createLabelIo: vi.fn(fakeLabelIo),
    createPrepareIo: vi.fn(() => ({}) as PrepareIo),
    runner: vi.fn(() => vi.fn(async () => '')),
    readFile: vi.fn(() => input),
    listPlugins: vi.fn(async () => [{ id: 'rules@m', version: '1.0.0' }]),
    pluginInfo: vi.fn(async () => ({ enabled: [], installs: [] })),
    exec: vi.fn(async () => ''),
    references: vi.fn(() => '/references'),
    runBench: vi.fn(async () => 7),
    runVerifierBench: vi.fn(async () => 8),
    runSelectionBench: vi.fn(async () => 9),
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
})

describe('runReviewCommand', () => {
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
    const printed = JSON.parse(out.join(''))
    expect(printed).toMatchObject({ verdict: 'Approve', label: 'unchanged' })
    expect(Array.isArray(printed.reviews)).toBe(true)
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
      reviews: 1,
      urls: ['https://example.test/r'],
      label: 'added',
      lifecycle: { added: ['final-review:complete'], removed: ['final-review:in-progress'] },
    })
    expect(d.createLabelIo).toHaveBeenCalledWith({ repo: 'acme/widgets', pr: 4 })
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
    expect(run.mock.calls[0]?.[0]).toEqual(
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
    run.mockRejectedValueOnce(new Error('403'))
    io.headSha.mockResolvedValueOnce(SHA)
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

  it('exits 0 for an approved status and 1 otherwise', async () => {
    const { out } = capture()
    const approved = fakeIo({
      listReviews: vi.fn(async () => [
        { body: `<!-- final-review sha=${SHA} verdict=Approve effort=high -->`, author: 'bot' },
      ]),
    })
    await expect(runReviewCommand(['status', ...PR], deps(approved))).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ approved: true })
    await expect(runReviewCommand(['status', ...PR], deps(fakeIo()))).resolves.toBe(1)
  })

  it('exits 0 for a skipped head even without the approval label', async () => {
    const { out } = capture()
    const skipped = fakeIo({
      hasApprovalLabel: vi.fn(async () => false),
      listReviews: vi.fn(async () => [
        { body: `<!-- final-review sha=${SHA} verdict=Skipped effort=low -->`, author: 'bot' },
      ]),
    })
    const done = deps(skipped)
    done.createLabelIo.mockReturnValue({
      ...fakeLabelIo(),
      labels: vi.fn(async () => ['final-review:complete']),
    })
    await expect(runReviewCommand(['status', ...PR], done)).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ approved: false, skipped: true })
    // A forced re-review swapped the completed label for the in-progress one.
    out.length = 0
    await expect(runReviewCommand(['status', ...PR], deps(skipped))).resolves.toBe(1)
    expect(JSON.parse(out.join(''))).toMatchObject({ skipped: false })
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
      'code-reviewer: give a subcommand: post, diff, revoke, status, auth, settings, queue, claim, abort, skip, prepare, review, report, resolve, plugins, bench, bench-verifier, or bench-selection.',
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
    const dir = mkdtempSync(join(tmpdir(), 'review-cmd-'))
    try {
      const file = join(dir, 'findings.json')
      writeFileSync(file, '{"findings": 3}')
      // Real file read and JSON parse happen before any gh call; the invalid findings abort first.
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
