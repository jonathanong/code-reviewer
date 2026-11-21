import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/index.mts')>()),
  listQueue: vi.fn(async () => [{ repo: 'acme/a', pr: 1 }]),
  claimReview: vi.fn(async () => ({ claimed: true })),
  abortReview: vi.fn(async () => ({ added: [] })),
  skipPullRequest: vi.fn(async () => ({
    headSha: 'h'.repeat(40),
    url: 'https://example.test/skip',
    added: ['done'],
    removed: ['busy'],
  })),
  prepareReview: vi.fn(async () => ({ headSha: 'h' })),
  resolveThreads: vi.fn(async (_run: unknown, ids: string[]) => ids),
  reviewStatus: vi.fn(async () => ({ current: false })),
}))

import {
  abortReview,
  claimReview,
  reviewStatus,
  listQueue,
  DEFAULT_LABELS,
  prepareReview,
  resolveThreads,
  skipPullRequest,
} from '../review/index.mts'
import { DEFAULT_PLAN_VALUES } from '../review/plan-settings.mts'
import { NO_CONFIGS, parseRepoConfig } from '../review/rules/config.mts'
import { runLoopCommand, skipCommand } from './command-loop.mts'
import { BOB, BOB_LABELS, LIMIT_DEFAULTS, fakeDeps, targetConfig } from './command-loop-fake-io.mts'

const TARGET = { repo: 'acme/widgets', pr: 4 }
const target = () => TARGET

afterEach(() => {
  vi.clearAllMocks()
})

const UNSET = {
  plan: DEFAULT_PLAN_VALUES,
  analysis: { tools: [], from: null },
  evidence: { sources: [], from: null },
  references: { sources: [], from: null },
  approvalCheck: { enabled: true, from: null },
  rulePlugins: { names: ['no-mistakes-rules', 'jong-skills'], from: null },
  limits: { ...LIMIT_DEFAULTS, maxCostUsd: null, from: null },
  pillars: {
    disabled: [],
    extra: [],
    modes: {
      light: ['rules', 'correctness', 'security'],
      full: ['rules', 'correctness', 'design', 'blast-radius', 'security', 'history'],
    },
    from: { disabled: 'default', extra: 'default' },
    problems: [],
  },
  models: {
    steps: {
      select: [{ harness: 'claude', model: 'haiku' }],
      pillars: [{ harness: 'claude', model: 'sonnet' }],
      'pillar.history': [{ harness: 'claude', model: 'haiku' }],
      verifier: [{ harness: 'claude', model: 'opus' }],
      'verifier.light': [{ harness: 'claude', model: 'sonnet' }],
      evidence: [{ harness: 'claude', model: 'sonnet' }],
      approvalCheck: [{ harness: 'claude', model: 'opus' }],
    },
    tiers: {
      small: [{ harness: 'claude', model: 'haiku' }],
      medium: [{ harness: 'claude', model: 'sonnet' }],
      large: [{ harness: 'claude', model: 'opus' }],
    },
    retry: { maxWaitSeconds: 600 },
    from: null,
  },
}

describe('runLoopCommand', () => {
  it('reports the auth mode and the identity that is trusted', async () => {
    await expect(runLoopCommand('auth', {}, target, fakeDeps().deps)).resolves.toEqual({
      mode: 'app',
      login: 'my-app[bot]',
    })
    await expect(runLoopCommand('auth', {}, target, fakeDeps('gh').deps)).resolves.toEqual({
      mode: 'gh',
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

  it('searches a named repository with the labels of its own file, reading only that file', async () => {
    const { deps, run } = fakeDeps()
    await runLoopCommand('queue', { repo: ['acme/c'] }, target, deps)
    expect(listQueue).toHaveBeenCalledWith(run, 'acme', ['acme/c'], {
      ...DEFAULT_LABELS,
      requested: 'please review',
    })
    expect(targetConfig.mock.calls).toEqual([['acme/c']])
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
    vi.mocked(reviewStatus).mockClear()
    await runLoopCommand('claim', { force: true }, target, deps)
    expect(claimReview).toHaveBeenLastCalledWith(labelIo, DEFAULT_LABELS, {
      force: true,
      headReviewed: false,
    })
    expect(reviewStatus).not.toHaveBeenCalled()
  })

  it('declines a head the newest review covers and reports its status', async () => {
    const { deps, labelIo } = fakeDeps()
    const status = { current: true, verdict: 'Approve' }
    vi.mocked(reviewStatus).mockResolvedValueOnce(status as never)
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
      review: 'https://example.test/skip',
      added: ['done'],
      removed: ['busy'],
    })
    expect(skipPullRequest).toHaveBeenLastCalledWith(
      expect.objectContaining({ headSha: expect.any(Function) }),
      labelIo,
      DEFAULT_LABELS,
      'docs only',
      undefined,
    )
  })

  it('passes the prepared head to skip and binds the check run to it', async () => {
    const { deps, run } = fakeDeps()
    await skipCommand({ reason: 'docs only' }, () => BOB, deps, 'p'.repeat(40))
    expect(skipPullRequest).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      'docs only',
      'p'.repeat(40),
    )
    expect(run.mock.calls[0]?.[0]).toContain(`head_sha=${'h'.repeat(40)}`)
  })

  it('leaves the labels and check run alone when the skip review is refused', async () => {
    const { deps, run } = fakeDeps()
    vi.mocked(skipPullRequest).mockRejectedValueOnce(new Error('head moved'))
    await expect(runLoopCommand('skip', { reason: 'x' }, () => BOB, deps)).rejects.toThrow(
      'head moved',
    )
    expect(run).not.toHaveBeenCalled()
  })

  describe('settings', () => {
    it('prints the resolved settings and the problems of the owner files', async () => {
      const { deps } = fakeDeps()
      await expect(runLoopCommand('settings', { owner: 'bob' }, target, deps)).resolves.toEqual({
        scope: 'bob',
        labels: BOB_LABELS,
        checkRun: { name: 'Code review' },
        from: {
          labels: {
            requested: 'machine owner',
            processing: 'default',
            completed: 'default',
            approval: 'default',
          },
          checkRun: 'machine owner',
        },
        analysis: { tools: ['graph'], from: 'machine owner' },
        evidence: { sources: ['aws'], from: 'machine owner' },
        references: {
          sources: [{ name: 'aws-docs', domains: ['docs.aws.amazon.com'] }],
          from: 'machine owner',
        },
        approvalCheck: { enabled: false, from: 'machine owner' },
        rulePlugins: { names: ['team-rules'], from: 'machine owner' },
        limits: { ...LIMIT_DEFAULTS, maxCostUsd: 1.5, from: 'machine owner' },
        pillars: UNSET.pillars,
        plan: UNSET.plan,
        models: {
          steps: {
            ...UNSET.models.steps,
            select: [{ harness: 'claude', model: 'sonnet' }],
            'pillar.history': [{ harness: 'claude', model: 'sonnet' }],
            'pillar.design': [{ harness: 'claude', model: 'opus' }],
          },
          tiers: { ...UNSET.models.tiers, small: [{ harness: 'claude', model: 'sonnet' }] },
          retry: { maxWaitSeconds: 30 },
          from: 'machine owner',
        },
        problems: ['bob.json: bad'],
      })
      await expect(runLoopCommand('settings', { repo: ['acme/b'] }, target, deps)).resolves.toEqual(
        {
          scope: 'acme/b',
          labels: { ...DEFAULT_LABELS, processing: 'busy' },
          checkRun: null,
          from: {
            labels: {
              requested: 'default',
              processing: 'machine repo',
              completed: 'default',
              approval: 'default',
            },
            checkRun: null,
          },
          ...UNSET,
          problems: [],
        },
      )
    })

    it('shows evidence, references and rule plugins from a trusted repository file as its own layer', async () => {
      const base = fakeDeps().deps
      const trusted = parseRepoConfig(
        '{"rulePlugins":["own-rules"],"references":[{"name":"docs","description":"Docs.","domains":["docs.example.com"]}]}',
        'acme/c/.code-reviewer.json',
        'trusted',
      )
      const configs = {
        byOwner: new Map(),
        byRepo: new Map([
          ['acme/c', parseRepoConfig('{"trustRepoConfig":true}', 'acme/c.json', 'repo')],
        ]),
        problems: [],
      }
      const deps = { ...base, configs: () => configs }
      targetConfig.mockResolvedValueOnce({ config: trusted, problems: [] })
      const result = (await runLoopCommand('settings', { repo: ['acme/c'] }, target, deps)) as {
        rulePlugins: unknown
        references: unknown
        evidence: unknown
      }
      expect(result.rulePlugins).toEqual({ names: ['own-rules'], from: 'repository file' })
      expect(result.references).toEqual({
        sources: [{ name: 'docs', domains: ['docs.example.com'] }],
        from: 'repository file',
      })
      expect(result.evidence).toEqual({ sources: [], from: null })
    })

    it('layers the repository file under the machine files and says where each value came from', async () => {
      const { deps } = fakeDeps()
      await expect(runLoopCommand('settings', { repo: ['acme/c'] }, target, deps)).resolves.toEqual(
        {
          scope: 'acme/c',
          labels: { ...DEFAULT_LABELS, requested: 'please review' },
          checkRun: { name: 'Own' },
          from: {
            labels: {
              requested: 'repository file',
              processing: 'default',
              completed: 'default',
              approval: 'default',
            },
            checkRun: 'repository file',
          },
          ...UNSET,
          problems: ['acme/c/.code-reviewer.json: unknown key "x" ignored'],
        },
      )
    })

    it('prints the pillars the repository file sets and what may run per mode', async () => {
      const { deps } = fakeDeps()
      const pillars = { disabled: ['history'], extra: [{ name: 'a11y', prompt: 'Look.' }] }
      targetConfig.mockResolvedValueOnce({
        config: parseRepoConfig(JSON.stringify({ pillars }), 'acme/c/.code-reviewer.json'),
        problems: [],
      })
      const printed = (await runLoopCommand('settings', { repo: ['acme/c'] }, target, deps)) as {
        pillars: { modes: unknown; from: unknown; extra: unknown }
      }
      expect(printed.pillars).toMatchObject({
        from: { disabled: 'repository file', extra: 'repository file' },
        extra: [{ name: 'a11y', modes: ['full'], uses: 'prompt' }],
        modes: {
          light: ['rules', 'correctness', 'security'],
          full: ['rules', 'correctness', 'design', 'blast-radius', 'security', 'a11y'],
        },
      })
    })

    it('prints evidence source names only, never commands or env values', async () => {
      const { deps } = fakeDeps()
      const printed = JSON.stringify(
        await runLoopCommand('settings', { owner: 'bob' }, target, deps),
      )
      expect(printed).toContain('"aws"')
      expect(printed).not.toContain('secret-profile-name')
      expect(printed).not.toContain('filter-log-events')
    })

    it('reads no repository file for an owner', async () => {
      const { deps } = fakeDeps()
      await runLoopCommand('settings', { owner: 'bob' }, target, deps)
      expect(targetConfig).not.toHaveBeenCalled()
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

  it('prepares into --out and requires it', async () => {
    const { deps, prepareIo } = fakeDeps()
    await expect(runLoopCommand('prepare', {}, target, deps)).rejects.toThrow(
      'prepare needs --out.',
    )
    await expect(runLoopCommand('prepare', { out: '/o' }, target, deps)).resolves.toEqual({
      headSha: 'h',
    })
    expect(prepareReview).toHaveBeenLastCalledWith(prepareIo, {
      out: '/o',
      pillars: { disabled: [], extra: [] },
      values: DEFAULT_PLAN_VALUES,
    })
  })

  it('plans with the pillars the config sets, and refuses when it leaves none to run', async () => {
    const { deps, prepareIo, configs } = fakeDeps()
    const set = (pillars: unknown) =>
      configs.mockReturnValueOnce({
        ...NO_CONFIGS,
        byRepo: new Map([
          ['acme/widgets', parseRepoConfig(JSON.stringify({ pillars }), 'acme/widgets.json')],
        ]),
      })
    set({ disabled: ['history'] })
    await runLoopCommand('prepare', { out: '/o' }, target, deps)
    expect(prepareReview).toHaveBeenLastCalledWith(prepareIo, {
      out: '/o',
      pillars: { disabled: ['history'], extra: [] },
      values: DEFAULT_PLAN_VALUES,
    })
    vi.mocked(prepareReview).mockClear()
    set({ disabled: ['rules', 'correctness', 'design', 'blast-radius', 'security', 'history'] })
    await expect(runLoopCommand('prepare', { out: '/o' }, target, deps)).rejects.toThrow(
      'every built-in pillar is disabled and no extra pillar runs in light reviews',
    )
    expect(prepareReview).not.toHaveBeenCalled()
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
      pillars: { disabled: [], extra: [] },
      values: DEFAULT_PLAN_VALUES,
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
