import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/index.mts')>()),
  listQueue: vi.fn(async () => [{ repo: 'acme/a', pr: 1 }]),
  claimReview: vi.fn(async () => ({ claimed: true })),
  abortReview: vi.fn(async () => ({ added: [] })),
  skipReview: vi.fn(async () => ({ added: ['done'], removed: ['busy'] })),
  prepareReview: vi.fn(async () => ({ headSha: 'h' })),
  resolveThreads: vi.fn(async (_run: unknown, ids: string[]) => ids),
  finalReviewStatus: vi.fn(async () => ({ current: false })),
}))

import {
  abortReview,
  claimReview,
  finalReviewStatus,
  listQueue,
  DEFAULT_LABELS,
  prepareReview,
  resolveThreads,
  skipReview,
  type LabelNames,
} from '../review/index.mts'
import { parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import { runLoopCommand } from './command-loop.mts'
import type { FinalReviewDeps } from './deps.mts'

const TARGET = { repo: 'acme/widgets', pr: 4 }
const target = () => TARGET

const BOB_LABELS: LabelNames = { ...DEFAULT_LABELS, requested: 'review me' }

function config(file: string, json: unknown, scope?: 'owner') {
  return parseRepoConfig(JSON.stringify(json), file, scope)
}

/** bob.json relabels and adds a check run for bob; acme/b relabels its own processing label. */
const CONFIGS: RepoConfigs = {
  byOwner: new Map([
    [
      'bob',
      config(
        'bob.json',
        { labels: { requested: 'review me' }, checkRun: { name: 'Final review' } },
        'owner',
      ),
    ],
  ]),
  byRepo: new Map([['acme/b', config('acme/b.json', { labels: { processing: 'busy' } })]]),
  problems: ['bob.json: bad'],
}

function fakeDeps(mode: 'app' | 'gh' = 'app') {
  const labelIo = { labels: vi.fn(), add: vi.fn(), remove: vi.fn() }
  const prepareIo = {} as ReturnType<FinalReviewDeps['createPrepareIo']>
  const run = vi.fn(async (_args: readonly string[]) => 'https://example.test/check\n')
  const runner = vi.fn(() => run)
  const createLabelIo = vi.fn(() => labelIo)
  const deps = {
    authMode: vi.fn(() => mode),
    configs: vi.fn(() => CONFIGS),
    createLabelIo,
    createIo: vi.fn(() => ({ headSha: async () => 'h'.repeat(40) })),
    createPrepareIo: vi.fn(() => prepareIo),
    runner,
  } as unknown as FinalReviewDeps
  return { deps, labelIo, prepareIo, run, runner, createLabelIo }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('runLoopCommand', () => {
  it('reports the auth mode', async () => {
    await expect(runLoopCommand('auth', {}, target, fakeDeps().deps)).resolves.toEqual({
      mode: 'app',
    })
  })

  it('lists the queue for --owner', async () => {
    const { deps, run, runner } = fakeDeps()
    await expect(runLoopCommand('queue', { owner: 'acme' }, target, deps)).resolves.toEqual([
      { repo: 'acme/a', pr: 1 },
    ])
    expect(runner).toHaveBeenCalledWith('acme')
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', [], DEFAULT_LABELS)
  })

  it('passes the repo name to the runner for a single repo', async () => {
    const { deps, run, runner } = fakeDeps()
    await runLoopCommand('queue', { repo: ['acme/a'] }, target, deps)
    expect(runner).toHaveBeenCalledWith('acme', 'a')
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', ['acme/a'], DEFAULT_LABELS)
  })

  it('searches an owner with the labels its file sets', async () => {
    const { deps, run } = fakeDeps()
    await runLoopCommand('queue', { owner: 'Bob' }, target, deps)
    expect(listQueue).toHaveBeenCalledWith(run, 'Bob', [], BOB_LABELS)
  })

  it('also searches repositories of an owner whose files change the search labels', async () => {
    const { deps, run, runner } = fakeDeps()
    const entry = (repo: string, pr: number) => ({ repo, pr })
    vi.mocked(listQueue)
      .mockResolvedValueOnce([entry('acme/a', 1), entry('acme/a', 1), entry('Acme/B', 9)] as never)
      .mockResolvedValueOnce([entry('acme/b', 2), entry('acme/b', 2)] as never)
    await expect(runLoopCommand('queue', { owner: 'acme' }, target, deps)).resolves.toEqual([
      entry('acme/a', 1),
      entry('acme/b', 2),
    ])
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', [], DEFAULT_LABELS)
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', ['acme/b'], {
      ...DEFAULT_LABELS,
      processing: 'busy',
    })
    expect(runner).toHaveBeenCalledWith('acme', 'b')
  })

  it('groups several repos per owner and label set and concatenates results', async () => {
    const { deps, run, runner } = fakeDeps()
    vi.mocked(listQueue)
      .mockResolvedValueOnce(['one'] as never)
      .mockResolvedValueOnce(['two'] as never)
      .mockResolvedValueOnce(['three'] as never)
    await expect(
      runLoopCommand('queue', { repo: ['acme/a', 'bob/c', 'acme/b', 'acme/d'] }, target, deps),
    ).resolves.toEqual(['one', 'two', 'three'])
    expect(runner).toHaveBeenCalledWith('acme', undefined)
    expect(runner).toHaveBeenCalledWith('bob', 'c')
    expect(runner).toHaveBeenCalledWith('acme', 'b')
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', ['acme/a', 'acme/d'], DEFAULT_LABELS)
    expect(listQueue).toHaveBeenCalledWith(run, 'bob', ['bob/c'], BOB_LABELS)
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', ['acme/b'], {
      ...DEFAULT_LABELS,
      processing: 'busy',
    })
  })

  it('needs an owner or a repo for the queue', async () => {
    await expect(runLoopCommand('queue', {}, target, fakeDeps().deps)).rejects.toThrow(
      'queue needs --owner or --repo.',
    )
  })

  it('claims with and without force', async () => {
    const { deps, labelIo, createLabelIo } = fakeDeps()
    await expect(runLoopCommand('claim', {}, target, deps)).resolves.toEqual({ claimed: true })
    expect(createLabelIo).toHaveBeenCalledWith(TARGET)
    expect(claimReview).toHaveBeenLastCalledWith(labelIo, DEFAULT_LABELS, {
      force: false,
      headReviewed: false,
    })
    vi.mocked(finalReviewStatus).mockClear()
    await runLoopCommand('claim', { force: true }, target, deps)
    expect(claimReview).toHaveBeenLastCalledWith(labelIo, DEFAULT_LABELS, {
      force: true,
      headReviewed: false,
    })
    expect(finalReviewStatus).not.toHaveBeenCalled()
  })

  it('declines a head the newest final review covers and reports its status', async () => {
    const { deps, labelIo } = fakeDeps()
    const status = { current: true, verdict: 'Approve' }
    vi.mocked(finalReviewStatus).mockResolvedValueOnce(status as never)
    vi.mocked(claimReview).mockResolvedValueOnce({
      claimed: false,
      reason: 'head already reviewed',
      labels: [],
    })
    await expect(runLoopCommand('claim', {}, target, deps)).resolves.toEqual({
      claimed: false,
      reason: 'head already reviewed',
      labels: [],
      status,
    })
    expect(claimReview).toHaveBeenLastCalledWith(labelIo, DEFAULT_LABELS, {
      force: false,
      headReviewed: true,
    })
  })

  it('aborts with and without requeue', async () => {
    const { deps, labelIo } = fakeDeps()
    await runLoopCommand('abort', {}, target, deps)
    expect(abortReview).toHaveBeenLastCalledWith(labelIo, DEFAULT_LABELS, { requeue: false })
    await runLoopCommand('abort', { requeue: true }, target, deps)
    expect(abortReview).toHaveBeenLastCalledWith(labelIo, DEFAULT_LABELS, { requeue: true })
  })

  it('skips a pull request with its reason and requires one', async () => {
    const { deps, labelIo } = fakeDeps()
    await expect(runLoopCommand('skip', {}, target, deps)).rejects.toThrow('skip needs --reason.')
    await expect(runLoopCommand('skip', { reason: ' ' }, target, deps)).rejects.toThrow(
      'skip needs --reason.',
    )
    await expect(runLoopCommand('skip', { reason: 'docs only' }, target, deps)).resolves.toEqual({
      skipped: true,
      reason: 'docs only',
      added: ['done'],
      removed: ['busy'],
    })
    expect(skipReview).toHaveBeenLastCalledWith(labelIo, DEFAULT_LABELS)
  })

  describe('settings', () => {
    it('prints the resolved settings and the problems of the owner files', async () => {
      const { deps } = fakeDeps()
      await expect(runLoopCommand('settings', { owner: 'bob' }, target, deps)).resolves.toEqual({
        scope: 'bob',
        labels: BOB_LABELS,
        checkRun: { name: 'Final review' },
        problems: ['bob.json: bad'],
      })
      await expect(runLoopCommand('settings', { repo: ['acme/b'] }, target, deps)).resolves.toEqual(
        {
          scope: 'acme/b',
          labels: { ...DEFAULT_LABELS, processing: 'busy' },
          checkRun: null,
          problems: [],
        },
      )
    })

    it('needs exactly one valid --repo or --owner', async () => {
      const { deps } = fakeDeps()
      const none = 'settings needs --repo or --owner.'
      await expect(runLoopCommand('settings', {}, target, deps)).rejects.toThrow(none)
      await expect(
        runLoopCommand('settings', { owner: 'bob', repo: ['bob/c'] }, target, deps),
      ).rejects.toThrow(none)
      await expect(runLoopCommand('settings', { owner: 'a b' }, target, deps)).rejects.toThrow(
        '--owner must be a GitHub login.',
      )
      await expect(runLoopCommand('settings', { repo: ['nope'] }, target, deps)).rejects.toThrow(
        '--repo must be owner/name.',
      )
    })
  })

  describe('check run', () => {
    const BOB = { repo: 'bob/c', pr: 4 }
    const posts = (run: { mock: { calls: unknown[][] } }) =>
      run.mock.calls.map(([args]) =>
        (args as string[]).filter((a) => /^(status|conclusion)=/u.test(a)),
      )

    it('starts on a claim and completes on abort and skip', async () => {
      const { deps, run } = fakeDeps()
      const claimed = await runLoopCommand('claim', { force: true }, () => BOB, deps)
      expect(claimed).toEqual({
        claimed: true,
        checkRun: { status: 'in_progress', url: 'https://example.test/check' },
      })
      await runLoopCommand('abort', {}, () => BOB, deps)
      await runLoopCommand('skip', { reason: 'docs only' }, () => BOB, deps)
      expect(posts(run)).toEqual([
        ['status=in_progress'],
        ['status=completed', 'conclusion=cancelled'],
        ['status=completed', 'conclusion=skipped'],
      ])
    })

    it('binds the check run to the head the claim read, and reads the head once for abort and skip', async () => {
      const claimHead = 's'.repeat(40)
      const { deps, run } = fakeDeps()
      vi.mocked(finalReviewStatus).mockResolvedValueOnce({
        current: false,
        headSha: claimHead,
      } as never)
      await runLoopCommand('claim', {}, () => BOB, deps)
      await runLoopCommand('abort', {}, () => BOB, deps)
      const heads = run.mock.calls.map(([args]) => args.find((a) => a.startsWith('head_sha=')))
      expect(heads).toEqual([`head_sha=${claimHead}`, `head_sha=${'h'.repeat(40)}`])
    })

    it('does not start one for a declined claim', async () => {
      const { deps, run } = fakeDeps()
      vi.mocked(claimReview).mockResolvedValueOnce({
        claimed: false,
        reason: 'already in progress',
        labels: [],
      })
      await runLoopCommand('claim', { force: true }, () => BOB, deps)
      expect(run).not.toHaveBeenCalled()
    })

    it('reports a skipped check run under the gh login and writes nothing', async () => {
      const { deps, run } = fakeDeps('gh')
      const result = await runLoopCommand('abort', {}, () => BOB, deps)
      expect(result).toMatchObject({
        checkRun: { status: 'skipped', reason: expect.stringContaining('App auth') },
      })
      expect(run).not.toHaveBeenCalled()
    })
  })

  it('prepares into --out and requires it', async () => {
    const { deps, prepareIo } = fakeDeps()
    await expect(runLoopCommand('prepare', {}, target, deps)).rejects.toThrow(
      'prepare needs --out.',
    )
    await expect(runLoopCommand('prepare', { out: '/o' }, target, deps)).resolves.toEqual({
      headSha: 'h',
    })
    expect(prepareReview).toHaveBeenLastCalledWith(prepareIo, { out: '/o' })
  })

  it('passes effort and tree through to prepare', async () => {
    const { deps, prepareIo } = fakeDeps()
    await runLoopCommand(
      'prepare',
      { out: '/o', effort: 'high', tree: '/t', clones: '/c' },
      target,
      deps,
    )
    expect(prepareReview).toHaveBeenLastCalledWith(prepareIo, {
      out: '/o',
      requested: 'high',
      tree: '/t',
      clones: '/c',
    })
    await expect(
      runLoopCommand('prepare', { out: '/o', effort: 'extreme' }, target, deps),
    ).rejects.toThrow(/--effort must be one of/u)
  })

  it('resolves threads for the target repository', async () => {
    const { deps, run, runner } = fakeDeps()
    await expect(
      runLoopCommand('resolve', { thread: ['T1', 'T2'] }, target, deps),
    ).resolves.toEqual({
      resolved: ['T1', 'T2'],
    })
    expect(runner).toHaveBeenCalledWith('acme', 'widgets')
    expect(resolveThreads).toHaveBeenLastCalledWith(run, ['T1', 'T2'])
    await runLoopCommand('resolve', {}, target, deps)
    expect(resolveThreads).toHaveBeenLastCalledWith(run, [])
  })

  it('returns undefined for other subcommands', async () => {
    await expect(runLoopCommand('post', {}, target, fakeDeps().deps)).resolves.toBeUndefined()
  })
})
