import { describe, expect, it } from 'vitest'

import { DEFAULT_MAX_COST_USD } from './rules/limits-parse.mts'
import { limitsProblems, parseMaxCost, requireLimits, resolveLimits } from './limits-settings.mts'
import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from './rules/config.mts'

const file = (limits: unknown) =>
  parseRepoConfig(JSON.stringify(limits === undefined ? {} : { limits }), 'f.json', 'repo')

const configs = (repo?: unknown, owner?: unknown): RepoConfigs => ({
  ...NO_CONFIGS,
  byRepo: repo === undefined ? new Map() : new Map([['acme/widgets', file(repo)]]),
  byOwner: owner === undefined ? new Map() : new Map([['acme', file(owner)]]),
})

const DEFAULTS = {
  runTimeoutSeconds: 1800,
  selectTimeoutSeconds: 120,
  contextDeadlineSeconds: 60,
  pillarJobs: 3,
}

describe('resolveLimits', () => {
  it('has the default ceiling when no machine file sets one', () => {
    expect(resolveLimits(NO_CONFIGS, 'acme/widgets')).toEqual({
      ...DEFAULTS,
      maxCostUsd: DEFAULT_MAX_COST_USD,
      maxCostFrom: null,
      from: null,
    })
    expect(resolveLimits(configs({}), 'acme/widgets')).toEqual({
      ...DEFAULTS,
      maxCostUsd: DEFAULT_MAX_COST_USD,
      maxCostFrom: null,
      from: null,
    })
  })

  it('takes the machine repo file over the machine owner file', () => {
    const both = configs({ maxCostUsd: 2 }, { maxCostUsd: 9 })
    expect(resolveLimits(both, 'acme/widgets')).toEqual({
      ...DEFAULTS,
      maxCostUsd: 2,
      maxCostFrom: 'machine repo',
      from: 'machine repo',
    })
    expect(resolveLimits(both, 'acme')).toEqual({
      ...DEFAULTS,
      maxCostUsd: 9,
      maxCostFrom: 'machine owner',
      from: 'machine owner',
    })
  })

  it('resolves each whole-number limit from the layers that set it', () => {
    const both = configs(
      { runTimeoutSeconds: 600, pillarJobs: 5 },
      { selectTimeoutSeconds: 30, contextDeadlineSeconds: 90 },
    )
    expect(resolveLimits(both, 'acme/widgets')).toEqual({
      runTimeoutSeconds: 600,
      selectTimeoutSeconds: 30,
      contextDeadlineSeconds: 90,
      pillarJobs: 5,
      maxCostUsd: DEFAULT_MAX_COST_USD,
      maxCostFrom: null,
      from: 'machine repo',
    })
    expect(resolveLimits(both, 'acme')).toMatchObject({
      selectTimeoutSeconds: 30,
      contextDeadlineSeconds: 90,
      runTimeoutSeconds: 1800,
    })
  })

  it('resolves each key from the narrowest layer that sets that key', () => {
    const both = configs(
      { pillarJobs: 5 },
      { maxCostUsd: 9, pillarJobs: 2, runTimeoutSeconds: 600 },
    )
    expect(resolveLimits(both, 'acme/widgets')).toEqual({
      ...DEFAULTS,
      maxCostUsd: 9,
      runTimeoutSeconds: 600,
      pillarJobs: 5,
      maxCostFrom: 'machine owner',
      from: 'machine repo',
    })
  })

  it('falls back to the owner file', () => {
    expect(resolveLimits(configs(undefined, { maxCostUsd: 9 }), 'acme/widgets')).toEqual({
      ...DEFAULTS,
      maxCostUsd: 9,
      maxCostFrom: 'machine owner',
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

describe('requireLimits', () => {
  const bad = {
    ...NO_CONFIGS,
    problems: [
      'Acme/Widgets.json limits.maxCostUsd: must be a number greater than 0; limits ignored',
      'acme/other.json limits.pillarJobs: bad; limits ignored',
      'acme/widgets.json pillars: other key',
    ],
  }

  it('lists only the limits problems of this repository or its owner', () => {
    expect(limitsProblems(bad, 'acme/widgets')).toHaveLength(1)
  })

  it('throws naming the problem, and otherwise resolves', () => {
    expect(() => requireLimits(bad, 'acme/widgets')).toThrow('limits.maxCostUsd')
    expect(requireLimits(configs({ pillarJobs: 4 }), 'acme/widgets').pillarJobs).toBe(4)
  })
})
