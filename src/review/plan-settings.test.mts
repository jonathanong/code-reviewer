import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PLAN_VALUES,
  FOLLOW_UP_SOURCE_LINES as SMALL_FOLLOW_UP,
  SMALL_PR_LINES,
  resolvePlanValues,
} from './plan-settings.mts'
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
    [
      'acme',
      config({
        securityPaths: ['a/**', 'shared/**'],
        authors: [{ login: 'owner-bot', review: 'skip' }],
      }),
    ],
  ]),
  byRepo: new Map([
    [
      'acme/web',
      config({
        securityPaths: ['shared/**', 'r/**'],
        generatedPaths: ['gen/**'],
        authors: [{ login: 'repo-bot', review: 'light' }],
        smallChangeLines: 20,
        sqlPaths: ['db/**'],
      }),
    ],
    [
      'acme/trusting',
      config({ smallChangeLines: 60, followUpSourceLines: 10 }, { trustRepoConfig: true }),
    ],
    ['acme/plain', config()],
  ]),
  problems: [],
}

const own = config({
  securityPaths: ['own/**'],
  generatedPaths: ['own-gen/**'],
  authors: [{ login: 'own-bot', review: 'skip' }],
  smallChangeLines: 500,
  sqlPaths: ['own-sql/**'],
  followUpSourceLines: 5,
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
      authors: [
        { login: 'repo-bot', review: 'light' },
        { login: 'owner-bot', review: 'skip' },
      ],
      smallChangeLines: 20,
      sqlPaths: ['db/**'],
      followUpSourceLines: SMALL_FOLLOW_UP,
    })
    expect(resolvePlanValues(configs, 'acme/plain')).toMatchObject({
      securityPaths: ['a/**', 'shared/**'],
      smallChangeLines: SMALL_PR_LINES,
    })
  })

  it("resolves an owner's shared settings without a repository", () => {
    expect(resolvePlanValues(configs, 'acme').authors).toEqual([
      { login: 'owner-bot', review: 'skip' },
    ])
  })

  it('takes only security paths from an untrusted repository file', () => {
    expect(resolvePlanValues(configs, 'acme/plain', own)).toEqual({
      securityPaths: ['a/**', 'shared/**', 'own/**'],
      generatedPaths: [],
      authors: [{ login: 'owner-bot', review: 'skip' }],
      smallChangeLines: SMALL_PR_LINES,
      sqlPaths: ['own-sql/**'],
      followUpSourceLines: SMALL_FOLLOW_UP,
    })
  })

  it('takes paths and the threshold, never authors, from a trusted repository file', () => {
    expect(resolvePlanValues(configs, 'acme/trusting', own)).toEqual({
      securityPaths: ['a/**', 'shared/**', 'own/**'],
      generatedPaths: ['own-gen/**'],
      authors: [{ login: 'owner-bot', review: 'skip' }],
      smallChangeLines: 60,
      sqlPaths: ['own-sql/**'],
      followUpSourceLines: 10,
    })
    const bare: RepoConfigs = {
      ...NO_CONFIGS,
      byRepo: new Map([['acme/t', config(undefined, { trustRepoConfig: true })]]),
    }
    expect(resolvePlanValues(bare, 'acme/t', own).smallChangeLines).toBe(500)
  })
})
