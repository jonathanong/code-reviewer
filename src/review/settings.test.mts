import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_RULE_PLUGINS } from './plugins.mts'
import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from './rules/config.mts'
import {
  DEFAULT_LABELS,
  repoSettings,
  resolveEvidence,
  resolveApprovalCheck,
  resolveReferences,
  resolveRulePlugins,
  reviewSettings,
  settingLayers,
  settingsProblems,
} from './settings.mts'

const ORG = parseRepoConfig(
  JSON.stringify({
    labels: { requested: 'org requested', approval: 'org approval' },
    checkRun: { name: 'Org review' },
  }),
  'Acme.json',
  'owner',
)
const REPO = parseRepoConfig(
  JSON.stringify({ labels: { approval: 'repo approval' }, checkRun: { name: 'Repo review' } }),
  'Acme/web.json',
)

const CONFIGS: RepoConfigs = {
  byOwner: new Map([['acme', ORG]]),
  byRepo: new Map([['acme/web', REPO]]),
  problems: [
    'Acme.json labels: unknown key "x" ignored',
    'Acme/web.json: bad',
    'Acmeish.json: bad',
  ],
}

describe('reviewSettings', () => {
  it('defaults every label and has no check run for an unconfigured repository', () => {
    expect(reviewSettings(CONFIGS, 'other/web')).toEqual({
      labels: DEFAULT_LABELS,
      checkRun: null,
    })
    expect(DEFAULT_LABELS).toEqual({
      requested: 'final-review:requested',
      processing: 'final-review:in-progress',
      completed: 'final-review:complete',
      approval: 'final approval',
    })
  })

  it('applies the owner file to its repositories and to the owner alone', () => {
    const expected = {
      labels: { ...DEFAULT_LABELS, requested: 'org requested', approval: 'org approval' },
      checkRun: { name: 'Org review' },
    }
    expect(reviewSettings(CONFIGS, 'acme/api')).toEqual(expected)
    expect(reviewSettings(CONFIGS, 'acme')).toEqual(expected)
  })

  it('lets the repository file override the owner file per key, case-insensitively', () => {
    expect(reviewSettings(CONFIGS, 'Acme/Web')).toEqual({
      labels: { ...DEFAULT_LABELS, requested: 'org requested', approval: 'repo approval' },
      checkRun: { name: 'Repo review' },
    })
  })
})

const OWN = parseRepoConfig(
  JSON.stringify({
    labels: { requested: 'own requested', processing: 'own busy', approval: 'own approval' },
    checkRun: { name: 'Own review' },
  }),
  'acme/web/.code-reviewer.json',
)

describe('the repository file layer', () => {
  it('sits under the machine files per key and per label name', () => {
    expect(reviewSettings(CONFIGS, 'acme/web', OWN)).toEqual({
      labels: {
        ...DEFAULT_LABELS,
        requested: 'org requested',
        processing: 'own busy',
        approval: 'repo approval',
      },
      checkRun: { name: 'Repo review' },
    })
    expect(settingLayers(CONFIGS, 'acme/web', OWN)).toEqual({
      labels: {
        requested: 'machine owner',
        processing: 'repository file',
        completed: 'default',
        approval: 'machine repo',
      },
      checkRun: 'machine repo',
    })
  })

  it('applies when no machine file exists, and never to an owner scope', () => {
    expect(reviewSettings(NO_CONFIGS, 'acme/web', OWN)).toEqual({
      labels: {
        ...DEFAULT_LABELS,
        requested: 'own requested',
        processing: 'own busy',
        approval: 'own approval',
      },
      checkRun: { name: 'Own review' },
    })
    expect(reviewSettings(NO_CONFIGS, 'acme', OWN)).toEqual({
      labels: DEFAULT_LABELS,
      checkRun: null,
    })
    expect(settingLayers(NO_CONFIGS, 'acme', OWN).checkRun).toBeNull()
    expect(settingLayers(NO_CONFIGS, 'acme/web', OWN).checkRun).toBe('repository file')
  })

  it('is read through repoSettings', async () => {
    const targetConfig = vi.fn(async () => ({ config: OWN, problems: [] }))
    const settings = await repoSettings({ configs: () => NO_CONFIGS, targetConfig }, 'acme/web')
    expect(settings.checkRun).toEqual({ name: 'Own review' })
    expect(targetConfig).toHaveBeenCalledWith('acme/web')
  })
})

describe('resolveEvidence', () => {
  const source = (name: string) => ({
    name,
    description: 'Logs.',
    guide: { file: '/g.md' },
    commands: ['aws logs get-query-results'],
    env: {},
  })
  const configs: RepoConfigs = {
    byOwner: new Map([['acme', { consumes: [], evidence: [source('owner')], problems: [] }]]),
    byRepo: new Map([
      ['acme/web', { consumes: [], evidence: [source('repo')], problems: [] }],
      ['acme/off', { consumes: [], evidence: [], problems: [] }],
      ['acme/plain', { consumes: [], problems: [] }],
    ]),
    problems: [],
  }

  it('takes the repository list over the owner list, replacing it whole', () => {
    expect(resolveEvidence(configs, 'acme/web')).toEqual({
      sources: [source('repo')],
      from: 'machine repo',
    })
  })

  it('falls back to the owner list, and lets a repository switch evidence off with []', () => {
    expect(resolveEvidence(configs, 'Acme/plain')).toEqual({
      sources: [source('owner')],
      from: 'machine owner',
    })
    expect(resolveEvidence(configs, 'acme')).toEqual({
      sources: [source('owner')],
      from: 'machine owner',
    })
    expect(resolveEvidence(configs, 'acme/off')).toEqual({ sources: [], from: 'machine repo' })
  })

  it('has none without a machine list', () => {
    expect(resolveEvidence(NO_CONFIGS, 'acme/web')).toEqual({ sources: [], from: null })
  })
})

describe('resolveReferences', () => {
  const source = (name: string) => ({ name, description: 'Docs.', domains: ['docs.example.com'] })
  const configs: RepoConfigs = {
    byOwner: new Map([['acme', { consumes: [], references: [source('owner')], problems: [] }]]),
    byRepo: new Map([
      ['acme/web', { consumes: [], references: [source('repo')], problems: [] }],
      ['acme/off', { consumes: [], references: [], problems: [] }],
      ['acme/plain', { consumes: [], problems: [] }],
    ]),
    problems: [],
  }

  it('takes the repository list over the owner list, replacing it whole', () => {
    expect(resolveReferences(configs, 'acme/web')).toEqual({
      sources: [source('repo')],
      from: 'machine repo',
    })
  })

  it('falls back to the owner list, and lets a repository switch references off with []', () => {
    expect(resolveReferences(configs, 'Acme/plain').from).toBe('machine owner')
    expect(resolveReferences(configs, 'acme').sources).toEqual([source('owner')])
    expect(resolveReferences(configs, 'acme/off')).toEqual({ sources: [], from: 'machine repo' })
  })

  it('has none without a machine list', () => {
    expect(resolveReferences(NO_CONFIGS, 'acme/web')).toEqual({ sources: [], from: null })
  })
})

describe('resolveApprovalCheck', () => {
  const configs: RepoConfigs = {
    byOwner: new Map([['acme', { consumes: [], approvalCheck: false, problems: [] }]]),
    byRepo: new Map([
      ['acme/on', { consumes: [], approvalCheck: true, problems: [] }],
      ['acme/plain', { consumes: [], problems: [] }],
    ]),
    problems: [],
  }

  it('is on without a machine value', () => {
    expect(resolveApprovalCheck(NO_CONFIGS, 'acme/web')).toEqual({ enabled: true, from: null })
  })

  it('takes the repository value over the owner value', () => {
    expect(resolveApprovalCheck(configs, 'acme/on')).toEqual({
      enabled: true,
      from: 'machine repo',
    })
    expect(resolveApprovalCheck(configs, 'acme/plain')).toEqual({
      enabled: false,
      from: 'machine owner',
    })
    expect(resolveApprovalCheck(configs, 'acme').enabled).toBe(false)
  })
})

describe('resolveRulePlugins', () => {
  const configs: RepoConfigs = {
    byOwner: new Map([['acme', { consumes: [], rulePlugins: ['owner-rules'], problems: [] }]]),
    byRepo: new Map([
      ['acme/none', { consumes: [], rulePlugins: [], problems: [] }],
      ['acme/plain', { consumes: [], problems: [] }],
    ]),
    problems: [],
  }

  it('is the default list without a machine value', () => {
    expect(resolveRulePlugins(NO_CONFIGS, 'acme/web')).toEqual({
      names: DEFAULT_RULE_PLUGINS,
      from: null,
    })
  })

  it('replaces the default whole, and the repository list replaces the owner list', () => {
    expect(resolveRulePlugins(configs, 'acme/plain')).toEqual({
      names: ['owner-rules'],
      from: 'machine owner',
    })
    expect(resolveRulePlugins(configs, 'acme').names).toEqual(['owner-rules'])
  })

  it('treats an empty list as a value, not as unset', () => {
    expect(resolveRulePlugins(configs, 'acme/none')).toEqual({ names: [], from: 'machine repo' })
  })
})

describe('settingsProblems', () => {
  it('lists the problems of the owner file and the owner directory only', () => {
    expect(settingsProblems(CONFIGS, 'ACME')).toEqual([
      'Acme.json labels: unknown key "x" ignored',
      'Acme/web.json: bad',
    ])
  })
})
