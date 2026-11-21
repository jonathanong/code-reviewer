import { describe, expect, it } from 'vitest'

import { DEFAULT_PLAN_VALUES, SMALL_PR_LINES, resolvePlanValues } from './plan-settings.mts'
import { NO_CONFIGS, type RepoConfig, type RepoConfigs } from './rules/config.mts'
import type { PlanConfig } from './rules/plan-parse.mts'

const config = (plan?: PlanConfig, extra: Partial<RepoConfig> = {}): RepoConfig => ({
  consumes: [],
  problems: [],
  ...(plan === undefined ? {} : { plan }),
  ...extra,
})

const configs: RepoConfigs = {
  byOwner: new Map([
    ['acme', config({ securityPaths: ['a/**', 'shared/**'], skipAuthors: ['owner-bot'] })],
  ]),
  byRepo: new Map([
    [
      'acme/web',
      config({
        securityPaths: ['shared/**', 'r/**'],
        generatedPaths: ['gen/**'],
        skipAuthors: ['repo-bot'],
        smallChangeLines: 20,
      }),
    ],
    ['acme/trusting', config({ smallChangeLines: 60 }, { trustRepoConfig: true })],
    ['acme/plain', config()],
  ]),
  problems: [],
}

const own = config({
  securityPaths: ['own/**'],
  generatedPaths: ['own-gen/**'],
  skipAuthors: ['own-bot'],
  smallChangeLines: 500,
})

describe('resolvePlanValues', () => {
  it('is the built-in behaviour without any configuration', () => {
    expect(resolvePlanValues(NO_CONFIGS, 'acme/web')).toEqual(DEFAULT_PLAN_VALUES)
    expect(DEFAULT_PLAN_VALUES.smallChangeLines).toBe(SMALL_PR_LINES)
  })

  it('unions the lists across machine layers and takes the threshold from the highest', () => {
    expect(resolvePlanValues(configs, 'Acme/web')).toEqual({
      securityPaths: ['shared/**', 'r/**', 'a/**'],
      generatedPaths: ['gen/**'],
      skipAuthors: ['repo-bot', 'owner-bot'],
      smallChangeLines: 20,
    })
    expect(resolvePlanValues(configs, 'acme/plain')).toMatchObject({
      securityPaths: ['a/**', 'shared/**'],
      smallChangeLines: SMALL_PR_LINES,
    })
  })

  it("resolves an owner's shared settings without a repository", () => {
    expect(resolvePlanValues(configs, 'acme').skipAuthors).toEqual(['owner-bot'])
  })

  it('takes only security paths from an untrusted repository file', () => {
    expect(resolvePlanValues(configs, 'acme/plain', own)).toEqual({
      securityPaths: ['a/**', 'shared/**', 'own/**'],
      generatedPaths: [],
      skipAuthors: ['owner-bot'],
      smallChangeLines: SMALL_PR_LINES,
    })
  })

  it('takes paths and the threshold, never authors, from a trusted repository file', () => {
    expect(resolvePlanValues(configs, 'acme/trusting', own)).toEqual({
      securityPaths: ['a/**', 'shared/**', 'own/**'],
      generatedPaths: ['own-gen/**'],
      skipAuthors: ['owner-bot'],
      smallChangeLines: 60,
    })
    const bare: RepoConfigs = {
      ...NO_CONFIGS,
      byRepo: new Map([['acme/t', config(undefined, { trustRepoConfig: true })]]),
    }
    expect(resolvePlanValues(bare, 'acme/t', own).smallChangeLines).toBe(500)
  })
})
