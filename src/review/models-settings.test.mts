import { describe, expect, it } from 'vitest'

import { resolveModels } from './models-settings.mts'
import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from './rules/config.mts'

const claude = (model: string) => ({ harness: 'claude', model })
const owner = parseRepoConfig('{"models":{"steps":{"select":"large"}}}', 'acme.json', 'owner')
const repo = parseRepoConfig('{"models":{"steps":{"evidence":"small"}}}', 'acme/web.json')

const CONFIGS: RepoConfigs = {
  byOwner: new Map([['acme', owner]]),
  byRepo: new Map([['acme/web', repo]]),
  problems: [],
}

describe('resolveModels', () => {
  it('is the defaults when no machine layer sets models', () => {
    const { plan, from } = resolveModels(NO_CONFIGS, 'acme/web')
    expect(from).toBeNull()
    expect(plan.steps).toEqual({})
    expect(plan.tiers.large).toEqual([claude('opus')])
  })

  it('takes the highest machine layer whole, the repository file over the owner file', () => {
    expect(resolveModels(CONFIGS, 'acme/web')).toMatchObject({
      from: 'machine repo',
      plan: { steps: { evidence: 'small' } },
    })
    expect(resolveModels(CONFIGS, 'acme/other')).toMatchObject({
      from: 'machine owner',
      plan: { steps: { select: 'large' } },
    })
  })

  it('applies the overrides on top', () => {
    const { plan } = resolveModels(CONFIGS, 'acme/web', { evidence: [claude('x')] })
    expect(plan.steps).toEqual({ evidence: [claude('x')] })
  })
})
