import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'

vi.mock('../final-review/benchmark/cli.mts', () => ({
  runFinalReviewBenchCli: vi.fn(async () => 5),
}))
vi.mock('../final-review/benchmark/verifier-cli.mts', () => ({
  runFinalReviewVerifierBenchCli: vi.fn(async () => 6),
}))

import type { FinalReviewIo, LabelIo, PrepareIo } from '../final-review/index.mts'
import { runFinalReviewBenchCli } from '../final-review/benchmark/cli.mts'
import { runFinalReviewVerifierBenchCli } from '../final-review/benchmark/verifier-cli.mts'
import { runFinalReviewCommand, type FinalReviewDeps } from './command.mts'

const SHA = 'e'.repeat(40)

type MockIo = { [K in keyof FinalReviewIo]: Mock<FinalReviewIo[K]> }

function fakeIo(overrides: Partial<MockIo> = {}): MockIo {
  return {
    headSha: vi.fn(async () => SHA),
    diff: vi.fn(async () => ''),
    listFiles: vi.fn(async () => []),
    listReviewBodies: vi.fn(async () => []),
    hasApprovalLabel: vi.fn(async () => true),
    postReview: vi.fn(async () => 'https://example.test/r'),
    addApprovalLabel: vi.fn(async () => undefined),
    removeApprovalLabel: vi.fn(async () => undefined),
    ...overrides,
  }
}

type MockDeps = { [K in keyof FinalReviewDeps]: Mock<FinalReviewDeps[K]> }

function fakeLabelIo(): LabelIo {
  return {
    labels: vi.fn(async () => ['final-review:in-progress']),
    add: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  }
}

function deps(io: FinalReviewIo, input = '{}'): MockDeps {
  return {
    authMode: vi.fn(() => 'gh' as const),
    createIo: vi.fn(() => io),
    createLabelIo: vi.fn(fakeLabelIo),
    createPrepareIo: vi.fn(() => ({}) as PrepareIo),
    runner: vi.fn(() => vi.fn(async () => '')),
    readFile: vi.fn(() => input),
    runBench: vi.fn(async () => 7),
    runVerifierBench: vi.fn(async () => 8),
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

describe('runFinalReviewCommand', () => {
  it('forwards bench arguments without parsing them', async () => {
    const d = deps(fakeIo())
    await expect(runFinalReviewCommand(['bench', '--cases', 'c'], d)).resolves.toBe(7)
    expect(d.runBench).toHaveBeenCalledWith(['--cases', 'c'])
    await expect(runFinalReviewCommand(['bench-verifier', '--out', 'o'], d)).resolves.toBe(8)
    expect(d.runVerifierBench).toHaveBeenCalledWith(['--out', 'o'])
    expect(d.createIo).not.toHaveBeenCalled()
  })

  it('resolves the pull request target for loop subcommands that need one', async () => {
    const { out } = capture()
    const d = deps(fakeIo())
    await expect(runFinalReviewCommand(['claim', ...PR, '--force'], d)).resolves.toBe(0)
    expect(d.createLabelIo).toHaveBeenCalledWith({ repo: 'acme/widgets', pr: 4 })
    expect(JSON.parse(out.join(''))).toMatchObject({ claimed: true })
  })

  it('posts a dry run and prints the full outcome', async () => {
    const { out } = capture()
    const d = deps(fakeIo(), JSON.stringify({ findings: [] }))
    await expect(
      runFinalReviewCommand(
        ['post', ...PR, '--head-sha', SHA, '--input', 'f.json', '--dry-run'],
        d,
      ),
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
      runFinalReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', 'f.json'], d),
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

  it('runs loop subcommands without a pull request target', async () => {
    const { out } = capture()
    const d = deps(fakeIo())
    await expect(runFinalReviewCommand(['auth'], d)).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toEqual({ mode: 'gh' })
    expect(d.createIo).not.toHaveBeenCalled()
  })

  it('requires --head-sha and --input for post', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    await expect(runFinalReviewCommand(['post', ...PR, '--input', 'f'], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand(['post', ...PR, '--head-sha', SHA], d)).resolves.toBe(2)
    expect(err.join('')).toBe(
      'final-review: post needs --head-sha and --input.\nfinal-review: post needs --head-sha and --input.\n',
    )
  })

  it('prints the numbered diff', async () => {
    const { out } = capture()
    const io = fakeIo({ diff: vi.fn(async () => '@@ -1 +1 @@\n+x') })
    await expect(runFinalReviewCommand(['diff', ...PR], deps(io))).resolves.toBe(0)
    expect(out.join('')).toBe('@@ -1 +1 @@\n            1 +x')
  })

  it('revokes the approval label', async () => {
    const { out } = capture()
    const io = fakeIo()
    await expect(runFinalReviewCommand(['revoke', ...PR], deps(io))).resolves.toBe(0)
    expect(io.removeApprovalLabel).toHaveBeenCalledOnce()
    expect(JSON.parse(out.join(''))).toEqual({ removed: true })
  })

  it('exits 0 for an approved status and 1 otherwise', async () => {
    const { out } = capture()
    const approved = fakeIo({
      listReviewBodies: vi.fn(async () => [
        `<!-- final-review sha=${SHA} verdict=Approve effort=high -->`,
      ]),
    })
    await expect(runFinalReviewCommand(['status', ...PR], deps(approved))).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toMatchObject({ approved: true })
    await expect(runFinalReviewCommand(['status', ...PR], deps(fakeIo()))).resolves.toBe(1)
  })

  it('reports usage and validation errors with exit code 2', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    await expect(runFinalReviewCommand(['status', '--pr', '4'], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand(['status', '--repo', 'a/b'], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand([], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand(['wat', ...PR], d)).resolves.toBe(2)
    await expect(runFinalReviewCommand(['status', '--bogus'], d)).resolves.toBe(2)
    expect(err.join('')).toContain('final-review: --repo and --pr are required.')
    expect(err.join('')).toContain(
      'final-review: final-review needs post, diff, revoke, status, auth, queue, claim, abort, prepare, resolve, bench, or bench-verifier.',
    )
  })

  it('prints usage for help', async () => {
    const { out } = capture()
    await expect(runFinalReviewCommand(['help'], deps(fakeIo()))).resolves.toBe(0)
    await expect(runFinalReviewCommand(['--help'], deps(fakeIo()))).resolves.toBe(0)
    expect(out.join('')).toContain('vouchington-reviewer post --repo')
  })

  it('stringifies non-Error failures', async () => {
    const { err } = capture()
    const d = deps(fakeIo())
    d.createIo.mockImplementation(() => {
      throw 'not an error'
    })
    await expect(runFinalReviewCommand(['status', ...PR], d)).resolves.toBe(2)
    expect(err.join('')).toBe('final-review: not an error\n')
  })
})

describe('runFinalReviewCommand default dependencies', () => {
  it('reads input from disk, builds a gh io, and delegates bench', async () => {
    const { err } = capture()
    const dir = mkdtempSync(join(tmpdir(), 'final-review-cmd-'))
    try {
      const file = join(dir, 'findings.json')
      writeFileSync(file, '{"findings": 3}')
      // Real file read and JSON parse happen before any gh call; the invalid findings abort first.
      await expect(
        runFinalReviewCommand(['post', ...PR, '--head-sha', SHA, '--input', file]),
      ).resolves.toBe(2)
      expect(err.join('')).toContain('findings must be an array.')
      // A malformed repo is rejected by the default gh io factory without running gh.
      await expect(runFinalReviewCommand(['status', '--repo', 'bad', '--pr', '1'])).resolves.toBe(2)
      expect(err.join('')).toContain('--repo must be owner/name.')
      await expect(runFinalReviewCommand(['bench', '--x'])).resolves.toBe(5)
      expect(runFinalReviewBenchCli).toHaveBeenCalledWith(['--x'])
      await expect(runFinalReviewCommand(['bench-verifier', '--y'])).resolves.toBe(6)
      expect(runFinalReviewVerifierBenchCli).toHaveBeenCalledWith(['--y'])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
