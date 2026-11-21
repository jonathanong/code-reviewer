import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('./command-loop.mts', () => ({
  claimCommand: vi.fn(async () => ({ claimed: true })),
  abortCommand: vi.fn(async () => ({ aborted: true })),
  skipCommand: vi.fn(async () => ({ skipped: true })),
  prepareCommand: vi.fn(async () => ({ headSha: 'sha' })),
}))
vi.mock('../review/post.mts', () => ({
  postFinalReview: vi.fn(async () => ({ verdict: 'Comment', reviews: [] })),
}))
vi.mock('../review/run/review.mts', () => ({
  runReview: vi.fn(async () => ({ ok: true, summary: { claimed: true } })),
}))

import { postFinalReview } from '../review/post.mts'
import { runReview, type ReviewSteps } from '../review/run/review.mts'
import { abortCommand, claimCommand, prepareCommand, skipCommand } from './command-loop.mts'
import { reportCommand, reviewCommand } from './command-review.mts'
import { resolveAnalysis } from '../review/analysis-settings.mts'
import { NO_CONFIGS, parseRepoConfig } from '../review/rules/config.mts'
import type { TargetConfig } from '../review/rules/target-config.mts'
import type { ReviewDeps } from './deps.mts'

afterEach(() => {
  vi.clearAllMocks()
  configs.mockImplementation(() => NO_CONFIGS)
})

const TARGET = { repo: 'acme/widgets', pr: 4 }
const guide = vi.fn(async () => 'guide text')
const configs = vi.fn(() => NO_CONFIGS)
const targetConfig = vi.fn(async (_repo: string): Promise<TargetConfig> => ({
  config: undefined,
  problems: [],
}))
const guideReader = vi.fn(() => guide)
const deps = {
  configs,
  targetConfig,
  guideReader,
  createIo: vi.fn(() => ({})),
  pluginInfo: vi.fn(async () => ({ enabled: [], installs: [] })),
  exec: vi.fn(async () => ''),
  references: vi.fn(() => '/refs'),
  tracker: vi.fn(() => ({
    dir: '/state',
    read: () => undefined,
    append: () => undefined,
    now: () => new Date('2026-05-06T07:08:09.000Z'),
  })),
} as unknown as ReviewDeps

async function steps(values: Parameters<typeof reviewCommand>[0] = { out: 'o', tree: 't' }) {
  await reviewCommand(values, TARGET, deps)
  const [wired, options] = vi.mocked(runReview).mock.calls[0] as unknown as [
    ReviewSteps,
    { jobs: number; out: string; tree: string },
  ]
  return { wired, options }
}

describe('reviewCommand', () => {
  it('needs --out and --tree', async () => {
    await expect(reviewCommand({ out: 'o' }, TARGET, deps)).rejects.toThrow(
      'review needs --out and --tree.',
    )
    await expect(reviewCommand({ tree: 't' }, TARGET, deps)).rejects.toThrow(
      'review needs --out and --tree.',
    )
  })

  it('resolves --out and --tree to absolute paths and defaults to three jobs', async () => {
    const { options } = await steps()
    expect(options).toMatchObject({
      repo: 'acme/widgets',
      pr: 4,
      out: resolve('o'),
      tree: resolve('t'),
      jobs: 3,
    })
  })

  it('validates --jobs', async () => {
    expect((await steps({ out: 'o', tree: 't', jobs: '5' })).options.jobs).toBe(5)
    for (const jobs of ['0', 'x', '1.5']) {
      await expect(reviewCommand({ out: 'o', tree: 't', jobs }, TARGET, deps)).rejects.toThrow(
        '--jobs must be a positive integer.',
      )
    }
  })

  it('wires each step to the shared command functions with resolved paths', async () => {
    const { wired } = await steps({ out: 'o', tree: 't', clones: 'c', force: true })
    await wired.claim()
    const targetOf = vi.mocked(claimCommand).mock.calls[0]?.[1] as () => unknown
    expect(targetOf()).toBe(TARGET)
    await wired.prepare()
    await wired.skip('why', 'f'.repeat(40))
    await wired.abort()
    expect(vi.mocked(skipCommand).mock.calls[0]?.[0]).toMatchObject({ reason: 'why' })
    expect(vi.mocked(skipCommand).mock.calls[0]?.[3]).toBe('f'.repeat(40))
    expect(vi.mocked(claimCommand).mock.calls[0]?.[0]).toMatchObject({
      out: resolve('o'),
      force: true,
    })
    expect(vi.mocked(prepareCommand).mock.calls[0]?.[0]).toMatchObject({
      out: resolve('o'),
      tree: resolve('t'),
      clones: resolve('c'),
    })
    expect(vi.mocked(skipCommand).mock.calls[0]?.[0]).toMatchObject({ reason: 'why' })
    expect(vi.mocked(abortCommand).mock.calls[0]?.[0]).toMatchObject({ requeue: false })
    expect(await wired.plugins()).toEqual({ enabled: [], installs: [] })
    expect(wired.exec).toBe(deps.exec)
    expect(wired.references).toBe('/refs')
  })

  it('wires the evidence step to the machine config and the clone root', async () => {
    const source = {
      name: 'aws',
      description: 'Logs.',
      guide: { file: '/g.md' },
      commands: ['aws logs get-query-results'],
      env: {},
    }
    // The pillars, the web references, the approval check, the rule plugins, the models and the limits read the configs first, when wired.
    configs
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce({
        ...NO_CONFIGS,
        byRepo: new Map([['acme/widgets', { consumes: [], evidence: [source], problems: [] }]]),
      })
    const { wired } = await steps({ out: 'o', tree: 't', clones: 'c' })
    const setup = await wired.evidence()
    expect(setup.sources).toEqual([source])
    expect(guideReader).toHaveBeenCalledWith(resolve('c'))
    expect(setup.readGuide).toBe(guide)
    expect((await wired.evidence()).sources).toEqual([])
  })

  it('wires the analysis tools from the machine config and the clone root', async () => {
    const tool = {
      name: 'graph',
      description: 'Code graph.',
      guide: { text: 'Use it.' },
      commands: ['graph dependents'],
    }
    configs.mockReturnValue({
      ...NO_CONFIGS,
      byRepo: new Map([['acme/widgets', { consumes: [], analysis: [tool], problems: [] }]]),
    })
    const { wired } = await steps({ out: 'o', tree: 't', clones: 'c' })
    const setup = await (wired.analysis as NonNullable<typeof wired.analysis>)()
    expect(setup.tools).toEqual([tool])
    expect(guideReader).toHaveBeenCalledWith(resolve('c'))
    expect(setup.readGuide).toBe(guide)
  })

  it('wires the web references from the machine config only', async () => {
    const reference = { name: 'aws', description: 'Docs.', domains: ['docs.aws.amazon.com'] }
    configs.mockReturnValueOnce(NO_CONFIGS).mockReturnValueOnce({
      ...NO_CONFIGS,
      byRepo: new Map([['acme/widgets', { consumes: [], references: [reference], problems: [] }]]),
    })
    expect((await steps()).wired.webReferences).toEqual([reference])
  })

  it('hands the review the pillars the config sets, and refuses before claiming when it leaves none', async () => {
    const set = (pillars: unknown) =>
      configs.mockReturnValueOnce({
        ...NO_CONFIGS,
        byRepo: new Map([
          ['acme/widgets', parseRepoConfig(JSON.stringify({ pillars }), 'acme/widgets.json')],
        ]),
      })
    expect((await steps()).wired.pillars).toEqual({ disabled: [], extra: [] })
    vi.clearAllMocks()
    set({ disabled: ['design'] })
    expect((await steps()).wired.pillars).toEqual({ disabled: ['design'], extra: [] })
    vi.clearAllMocks()
    set({ disabled: ['rules', 'correctness', 'design', 'blast-radius', 'security', 'history'] })
    await expect(reviewCommand({ out: 'o', tree: 't' }, TARGET, deps)).rejects.toThrow(
      'every built-in pillar is disabled',
    )
    expect(runReview).not.toHaveBeenCalled()
    expect(claimCommand).not.toHaveBeenCalled()
  })

  it('takes evidence, references and rule plugins from a repository file only when trusted', async () => {
    const own = {
      consumes: [],
      evidence: [
        { name: 'own', description: 'Logs.', guide: { file: '/g.md' }, commands: ['ls'], env: {} },
      ],
      references: [{ name: 'own', description: 'Docs.', domains: ['own.example.com'] }],
      rulePlugins: ['own-rules'],
      problems: [],
    }
    targetConfig.mockResolvedValue({ config: own, problems: [] })
    const untrusted = await steps()
    expect(targetConfig).toHaveBeenCalledWith('acme/widgets')
    expect(untrusted.wired.webReferences).toEqual([])
    expect(untrusted.wired.rulePlugins).toEqual(['no-mistakes-rules', 'jong-skills'])
    vi.clearAllMocks()
    configs.mockReturnValue({
      ...NO_CONFIGS,
      byRepo: new Map([['acme/widgets', { consumes: [], trustRepoConfig: true, problems: [] }]]),
    })
    try {
      const { wired } = await steps()
      expect(wired.webReferences).toEqual(own.references)
      expect(wired.rulePlugins).toEqual(['own-rules'])
      expect((await wired.evidence()).sources).toEqual(own.evidence)
    } finally {
      configs.mockReturnValue(NO_CONFIGS)
      targetConfig.mockResolvedValue({ config: undefined, problems: [] })
    }
  })

  it('grants no analysis from a trusted repository file', async () => {
    const tool = {
      name: 'own',
      description: 'Graph.',
      guide: { text: 'Use it.' },
      commands: ['graph dependents'],
    }
    const own = parseRepoConfig(
      JSON.stringify({ analysis: [tool] }),
      'acme/widgets/.code-reviewer.json',
      'trusted',
    )
    expect(own.analysis).toBeUndefined()
    targetConfig.mockResolvedValue({ config: own, problems: own.problems })
    configs.mockReturnValue({
      ...NO_CONFIGS,
      byRepo: new Map([['acme/widgets', { consumes: [], trustRepoConfig: true, problems: [] }]]),
    })
    try {
      const { wired } = await steps()
      const setup = await (wired.analysis as NonNullable<typeof wired.analysis>)()
      expect(setup.tools).toEqual([])
      expect(resolveAnalysis(configs(), 'acme/widgets').tools).toEqual([])
    } finally {
      configs.mockReturnValue(NO_CONFIGS)
      targetConfig.mockResolvedValue({ config: undefined, problems: [] })
    }
  })

  it('has no web references without a machine list', async () => {
    expect((await steps()).wired.webReferences).toEqual([])
  })

  it('runs the approval check unless a machine config switches it off', async () => {
    expect((await steps()).wired.approvalCheck).toBe(true)
    vi.clearAllMocks()
    configs
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce({
        ...NO_CONFIGS,
        byRepo: new Map([['acme/widgets', { consumes: [], approvalCheck: false, problems: [] }]]),
      })
    expect((await steps()).wired.approvalCheck).toBe(false)
  })

  it('uses the default rule plugins unless a machine config lists others, even none', async () => {
    expect((await steps()).wired.rulePlugins).toEqual(['no-mistakes-rules', 'jong-skills'])
    vi.clearAllMocks()
    configs
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce(NO_CONFIGS)
      .mockReturnValueOnce({
        ...NO_CONFIGS,
        byRepo: new Map([['acme/widgets', { consumes: [], rulePlugins: [], problems: [] }]]),
      })
    expect((await steps()).wired.rulePlugins).toEqual([])
  })

  it('gives the models a watch that writes progress to deps unless --quiet', async () => {
    const progress = vi.fn()
    const loud = { ...deps, progress } as unknown as ReviewDeps
    await reviewCommand({ out: 'o', tree: 't' }, TARGET, loud)
    const [first] = vi.mocked(runReview).mock.calls[0] as unknown as [ReviewSteps]
    first.models?.watch?.write?.('hello\n')
    expect(progress).toHaveBeenCalledWith('hello\n')
    vi.clearAllMocks()
    await reviewCommand({ out: 'o', tree: 't', quiet: true }, TARGET, loud)
    const [second] = vi.mocked(runReview).mock.calls[0] as unknown as [ReviewSteps]
    expect(second.models?.watch?.write).toBeUndefined()
  })

  it('sets the cost ceiling from --max-cost, and rejects a bad one before anything runs', async () => {
    const { wired } = await steps({ out: 'o', tree: 't', 'max-cost': '3' })
    expect(wired.models?.watch?.ceilingUsd).toBe(3)
    vi.clearAllMocks()
    await expect(
      reviewCommand({ out: 'o', tree: 't', 'max-cost': '-1' }, TARGET, deps),
    ).rejects.toThrow('--max-cost')
    expect(runReview).not.toHaveBeenCalled()
  })

  it('previews with a dry run', async () => {
    const { wired } = await steps()
    const input = { effort: 'high', summary: '', skipped: [], findings: [] } as never
    await wired.preview(input, 'sha')
    expect(postFinalReview).toHaveBeenCalledWith(expect.anything(), input, 'sha', { dryRun: true })
  })
})

describe('reportCommand', () => {
  it('needs --out', () => {
    expect(() => reportCommand({})).toThrow('report needs --out.')
  })

  it('renders report.md again from report.json', () => {
    const out = mkdtempSync(join(tmpdir(), 'report-cmd-'))
    try {
      writeFileSync(
        join(out, 'report.json'),
        JSON.stringify({
          version: 1,
          repo: 'a/b',
          pr: 1,
          title: 'T',
          url: 'u',
          headSha: 'abcdef0123',
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
      const { report } = reportCommand({ out })
      expect(report).toBe(join(out, 'report.md'))
      expect(readFileSync(report, 'utf8')).toContain('**Skipped:** Nope.')
    } finally {
      rmSync(out, { recursive: true, force: true })
    }
  })
})
