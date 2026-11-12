import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../final-review/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../final-review/index.mts')>()),
  listQueue: vi.fn(async () => ['queued']),
  claimReview: vi.fn(async () => ({ claimed: true })),
  abortReview: vi.fn(async () => ({ added: [] })),
  prepareReview: vi.fn(async () => ({ headSha: 'h' })),
  resolveThreads: vi.fn(async (_run: unknown, ids: string[]) => ids),
  finalReviewStatus: vi.fn(async () => ({ current: false })),
}))

import {
  abortReview,
  claimReview,
  finalReviewStatus,
  listQueue,
  prepareReview,
  resolveThreads,
} from '../final-review/index.mts'
import { runLoopCommand } from './command-loop.mts'
import type { FinalReviewDeps } from './deps.mts'

const TARGET = { repo: 'acme/widgets', pr: 4 }
const target = () => TARGET

function fakeDeps() {
  const labelIo = { labels: vi.fn(), add: vi.fn(), remove: vi.fn() }
  const prepareIo = {} as ReturnType<FinalReviewDeps['createPrepareIo']>
  const run = vi.fn()
  const runner = vi.fn(() => run)
  const createLabelIo = vi.fn(() => labelIo)
  const deps = {
    authMode: vi.fn(() => 'app' as const),
    createLabelIo,
    createIo: vi.fn(() => ({})),
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
      'queued',
    ])
    expect(runner).toHaveBeenCalledWith('acme')
    expect(listQueue).toHaveBeenCalledWith(run, 'acme')
  })

  it('passes the repo name to the runner for a single repo', async () => {
    const { deps, run, runner } = fakeDeps()
    await runLoopCommand('queue', { repo: ['acme/a'] }, target, deps)
    expect(runner).toHaveBeenCalledWith('acme', 'a')
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', ['acme/a'])
  })

  it('groups several repos per owner and concatenates results', async () => {
    const { deps, run, runner } = fakeDeps()
    vi.mocked(listQueue)
      .mockResolvedValueOnce(['one'] as never)
      .mockResolvedValueOnce(['two'] as never)
    await expect(
      runLoopCommand('queue', { repo: ['acme/a', 'bob/c', 'acme/b'] }, target, deps),
    ).resolves.toEqual(['one', 'two'])
    expect(runner).toHaveBeenCalledWith('acme', undefined)
    expect(runner).toHaveBeenCalledWith('bob', 'c')
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', ['acme/a', 'acme/b'])
    expect(listQueue).toHaveBeenCalledWith(run, 'bob', ['bob/c'])
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
    expect(claimReview).toHaveBeenLastCalledWith(labelIo, { force: false, headReviewed: false })
    vi.mocked(finalReviewStatus).mockClear()
    await runLoopCommand('claim', { force: true }, target, deps)
    expect(claimReview).toHaveBeenLastCalledWith(labelIo, { force: true, headReviewed: false })
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
    expect(claimReview).toHaveBeenLastCalledWith(labelIo, { force: false, headReviewed: true })
  })

  it('aborts with and without requeue', async () => {
    const { deps, labelIo } = fakeDeps()
    await runLoopCommand('abort', {}, target, deps)
    expect(abortReview).toHaveBeenLastCalledWith(labelIo, { requeue: false })
    await runLoopCommand('abort', { requeue: true }, target, deps)
    expect(abortReview).toHaveBeenLastCalledWith(labelIo, { requeue: true })
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
    await runLoopCommand('prepare', { out: '/o', effort: 'high', tree: '/t' }, target, deps)
    expect(prepareReview).toHaveBeenLastCalledWith(prepareIo, {
      out: '/o',
      requested: 'high',
      tree: '/t',
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
