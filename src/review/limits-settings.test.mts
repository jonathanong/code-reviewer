import { describe, expect, it } from 'vitest'

import { parseMaxCost, resolveLimits } from './limits-settings.mts'
import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from './rules/config.mts'

const file = (limits: unknown) =>
  parseRepoConfig(JSON.stringify(limits === undefined ? {} : { limits }), 'f.json', 'repo')

const configs = (repo?: unknown, owner?: unknown): RepoConfigs => ({
  ...NO_CONFIGS,
  byRepo: repo === undefined ? new Map() : new Map([['acme/widgets', file(repo)]]),
  byOwner: owner === undefined ? new Map() : new Map([['acme', file(owner)]]),
})

describe('resolveLimits', () => {
  it('has no ceiling when no machine file sets one', () => {
    expect(resolveLimits(NO_CONFIGS, 'acme/widgets')).toEqual({
      maxCostUsd: undefined,
      from: null,
    })
    expect(resolveLimits(configs({}), 'acme/widgets')).toEqual({
      maxCostUsd: undefined,
      from: null,
    })
  })

  it('takes the machine repo file over the machine owner file', () => {
    const both = configs({ maxCostUsd: 2 }, { maxCostUsd: 9 })
    expect(resolveLimits(both, 'acme/widgets')).toEqual({ maxCostUsd: 2, from: 'machine repo' })
    expect(resolveLimits(both, 'acme')).toEqual({ maxCostUsd: 9, from: 'machine owner' })
  })

  it('falls back to the owner file', () => {
    expect(resolveLimits(configs(undefined, { maxCostUsd: 9 }), 'acme/widgets')).toEqual({
      maxCostUsd: 9,
      from: 'machine owner',
    })
  })
})

describe('parseMaxCost', () => {
  it('is absent when the flag is', () => {
    expect(parseMaxCost(undefined)).toBeUndefined()
  })

  it('reads dollars', () => {
    expect(parseMaxCost('1.5')).toBe(1.5)
  })

  it.each(['0', '-2', 'abc', '', ' ', 'Infinity', 'NaN'])('rejects %j', (value) => {
    expect(() => parseMaxCost(value)).toThrow('--max-cost must be a number')
  })
})
