import { describe, expect, it } from 'vitest'

import { parseRepoConfig, type RepoConfigs } from './rules/config.mts'
import { DEFAULT_LABELS, reviewSettings, settingsProblems } from './settings.mts'

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

describe('settingsProblems', () => {
  it('lists the problems of the owner file and the owner directory only', () => {
    expect(settingsProblems(CONFIGS, 'ACME')).toEqual([
      'Acme.json labels: unknown key "x" ignored',
      'Acme/web.json: bad',
    ])
  })
})
