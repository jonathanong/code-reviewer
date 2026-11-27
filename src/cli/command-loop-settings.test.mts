import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/index.mts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../review/index.mts')>()),
}))

import { DEFAULT_LABELS } from '../review/index.mts'
import { DEFAULT_PLAN_VALUES } from '../review/plan-settings.mts'
import { parseRepoConfig } from '../review/rules/config.mts'
import { runLoopCommand } from './command-loop.mts'
import { BOB_LABELS, LIMIT_DEFAULTS, fakeDeps, targetConfig } from './command-loop-fake-io.mts'
import { builtInTargets } from '../review/targets.mts'
import { DEFAULT_RULE_PLUGINS } from '../review/plugins.mts'

const TARGET = { repo: 'acme/widgets', pr: 4 }
const target = () => TARGET

afterEach(() => void vi.clearAllMocks())

const UNSET = {
  plan: { ...DEFAULT_PLAN_VALUES, authors: [{ login: 'dependabot[bot]', review: 'light' }] },
  analysis: { tools: [], from: null },
  evidence: { sources: [], from: null },
  references: { sources: [], from: null },
  approvalCheck: { enabled: true, from: null },
  answers: { enabled: false, from: null },
  upgrades: { enabled: false, packages: [], from: null },
  requestFocus: { enabled: false, from: null },
  rulePlugins: { names: DEFAULT_RULE_PLUGINS, from: null },
  limits: { ...LIMIT_DEFAULTS, maxCostFrom: null, from: null },
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
  targets: { disabled: [], enabled: builtInTargets().map((t) => t.name), from: 'default' },
  models: {
    steps: {
      select: [{ harness: 'claude', model: 'haiku' }],
      pillars: [{ harness: 'claude', model: 'sonnet' }],
      focus: [{ harness: 'claude', model: 'sonnet' }],
      'pillar.history': [{ harness: 'claude', model: 'haiku' }],
      verifier: [{ harness: 'claude', model: 'opus' }],
      'verifier.light': [{ harness: 'claude', model: 'sonnet' }],
      evidence: [{ harness: 'claude', model: 'sonnet' }],
      approvalCheck: [{ harness: 'claude', model: 'opus' }],
      replies: [{ harness: 'claude', model: 'sonnet' }],
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

describe('settings', () => {
  it('prints the resolved settings and the problems of the owner files', async () => {
    const { deps } = fakeDeps('app', ['bob.json: bad'])
    await expect(runLoopCommand('settings', { owner: 'bob' }, target, deps)).resolves.toEqual({
      scope: 'bob',
      labels: BOB_LABELS,
      checkRun: { name: 'Code review' },
      from: {
        labels: {
          requested: 'machine owner',
          processing: 'default',
          completed: 'default',
          held: 'default',
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
      answers: { enabled: false, from: null },
      upgrades: { enabled: false, packages: [], from: null },
      requestFocus: { enabled: false, from: null },
      rulePlugins: { names: ['team-rules'], from: 'machine owner' },
      limits: {
        ...LIMIT_DEFAULTS,
        maxCostUsd: 1.5,
        maxCostFrom: 'machine owner',
        from: 'machine owner',
      },
      pillars: UNSET.pillars,
      targets: UNSET.targets,
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
    await expect(runLoopCommand('settings', { repo: ['acme/b'] }, target, deps)).resolves.toEqual({
      scope: 'acme/b',
      labels: { ...DEFAULT_LABELS, processing: 'busy' },
      checkRun: null,
      from: {
        labels: {
          requested: 'default',
          processing: 'machine repo',
          completed: 'default',
          held: 'default',
          approval: 'default',
        },
        checkRun: null,
      },
      ...UNSET,
      problems: [],
    })
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
    await expect(runLoopCommand('settings', { repo: ['acme/c'] }, target, deps)).resolves.toEqual({
      scope: 'acme/c',
      labels: { ...DEFAULT_LABELS, requested: 'please review' },
      checkRun: { name: 'Own' },
      from: {
        labels: {
          requested: 'repository file',
          processing: 'default',
          completed: 'default',
          held: 'default',
          approval: 'default',
        },
        checkRun: 'repository file',
      },
      ...UNSET,
      problems: ['acme/c/.code-reviewer.json: unknown key "x" ignored'],
    })
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
    const printed = JSON.stringify(await runLoopCommand('settings', { owner: 'bob' }, target, deps))
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
