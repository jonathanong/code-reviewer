import { describe, expect, it } from 'vitest'

import {
  resolveEvidence,
  resolveReferences,
  resolveRulePlugins,
  trustsRepoConfig,
} from './grant-settings.mts'
import { DEFAULT_RULE_PLUGINS } from './plugins.mts'
import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from './rules/config.mts'

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

describe('trusted repository file', () => {
  const evidence = (name: string) => ({
    name,
    description: 'Logs.',
    guide: { file: '/g.md' },
    commands: ['aws logs get-query-results'],
    env: {},
  })
  const own = {
    consumes: [],
    evidence: [evidence('own')],
    references: [{ name: 'own', description: 'Docs.', domains: ['own.example.com'] }],
    rulePlugins: ['own-rules'],
    problems: [],
  }
  const configs = (repo: object, owner: object = {}): RepoConfigs => ({
    byOwner: new Map([['acme', { consumes: [], ...owner, problems: [] }]]),
    byRepo: new Map([['acme/web', { consumes: [], ...repo, problems: [] }]]),
    problems: [],
  })

  it('ignores the repository file without trustRepoConfig', () => {
    const untrusted = configs({})
    expect(trustsRepoConfig(untrusted, 'acme/web')).toBe(false)
    expect(resolveEvidence(untrusted, 'acme/web', own)).toEqual({ sources: [], from: null })
    expect(resolveReferences(untrusted, 'acme/web', own)).toEqual({ sources: [], from: null })
    expect(resolveRulePlugins(untrusted, 'acme/web', own)).toEqual({
      names: DEFAULT_RULE_PLUGINS,
      from: null,
    })
  })

  it('uses the repository file as the lowest layer when trusted by the repo file', () => {
    const trusted = configs({ trustRepoConfig: true })
    expect(resolveEvidence(trusted, 'acme/web', own)).toEqual({
      sources: own.evidence,
      from: 'repository file',
    })
    expect(resolveReferences(trusted, 'acme/web', own).from).toBe('repository file')
    expect(resolveRulePlugins(trusted, 'acme/web', own)).toEqual({
      names: ['own-rules'],
      from: 'repository file',
    })
  })

  it('trusts through the owner file, and a repo-file false overrides it', () => {
    expect(trustsRepoConfig(configs({}, { trustRepoConfig: true }), 'acme/web')).toBe(true)
    const off = configs({ trustRepoConfig: false }, { trustRepoConfig: true })
    expect(resolveRulePlugins(off, 'acme/web', own).from).toBe(null)
  })

  it('lets machine layers win over the repository file, key by key', () => {
    const trusted = configs(
      { trustRepoConfig: true, rulePlugins: ['machine-rules'] },
      { evidence: [evidence('owner')] },
    )
    expect(resolveRulePlugins(trusted, 'acme/web', own)).toEqual({
      names: ['machine-rules'],
      from: 'machine repo',
    })
    expect(resolveEvidence(trusted, 'acme/web', own).from).toBe('machine owner')
    expect(resolveReferences(trusted, 'acme/web', own).from).toBe('repository file')
  })

  it('never consults a repository file for an owner scope', () => {
    const trusted = configs({}, { trustRepoConfig: true })
    expect(resolveRulePlugins(trusted, 'acme', own).from).toBe(null)
  })
})

describe('parsing trustRepoConfig', () => {
  const text = JSON.stringify({
    evidence: [],
    references: [],
    rulePlugins: ['own-rules'],
    approvalCheck: false,
    trustRepoConfig: true,
  })

  it('is machine-only: a repository file naming it gets a problem', () => {
    for (const scope of ['target', 'trusted'] as const) {
      const config = parseRepoConfig(text, 'acme/.code-reviewer.json', scope)
      expect(config.trustRepoConfig).toBeUndefined()
      expect(config.problems).toContain(
        'acme/.code-reviewer.json: trustRepoConfig is machine-only; ignored',
      )
    }
  })

  it('lets a trusted repository file set only evidence, references and rulePlugins', () => {
    const config = parseRepoConfig(text, 'acme/.code-reviewer.json', 'trusted')
    expect(config.rulePlugins).toEqual(['own-rules'])
    expect(config.evidence).toEqual([])
    expect(config.references).toEqual([])
    expect(config.approvalCheck).toBeUndefined()
  })

  it('validates a trusted file like a machine file', () => {
    const config = parseRepoConfig('{"rulePlugins": "x"}', 'acme/.code-reviewer.json', 'trusted')
    expect(config.rulePlugins).toBeUndefined()
    expect(config.problems.join()).toContain('acme/.code-reviewer.json rulePlugins')
  })

  it('keeps ignoring them in an untrusted repository file', () => {
    const config = parseRepoConfig(text, 'acme/.code-reviewer.json', 'target')
    expect(config.rulePlugins).toBeUndefined()
    expect(config.problems).toContain(
      'acme/.code-reviewer.json: rulePlugins is machine-only; ignored',
    )
  })

  it('is accepted in machine repo and owner files', () => {
    expect(parseRepoConfig('{"trustRepoConfig": true}', 'a/b.json', 'repo').trustRepoConfig).toBe(
      true,
    )
    expect(parseRepoConfig('{"trustRepoConfig": true}', 'a.json', 'owner').trustRepoConfig).toBe(
      true,
    )
    const bad = parseRepoConfig('{"trustRepoConfig": "yes"}', 'a.json', 'owner')
    expect(bad.trustRepoConfig).toBeUndefined()
    expect(bad.problems).toHaveLength(1)
  })
})
