import { describe, expect, it, vi } from 'vitest'

import { DEFAULT_MAX_COST_USD } from '../review/rules/limits-parse.mts'
import { resolveLimits } from '../review/limits-settings.mts'
import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import type { ReviewDeps } from './deps.mts'
import { stepWatchFor } from './step-watch-for.mts'

const OWNER_CEILING: RepoConfigs = {
  ...NO_CONFIGS,
  byOwner: new Map([
    ['acme', parseRepoConfig('{"limits":{"maxCostUsd":4}}', 'acme.json', 'owner')],
  ]),
}

const limitsOf = (configs: RepoConfigs) => resolveLimits(configs, 'acme/widgets')

function fakeDeps() {
  const progress = vi.fn()
  const deps = {
    tracker: () => ({ now: () => new Date(5000) }),
    progress,
  } as unknown as ReviewDeps
  return { deps, progress }
}

describe('stepWatchFor', () => {
  it('has the default ceiling when neither the flag nor a machine file sets one', () => {
    const { deps } = fakeDeps()
    expect(stepWatchFor({}, limitsOf(NO_CONFIGS), deps).ceilingUsd).toBe(DEFAULT_MAX_COST_USD)
  })

  it('takes the ceiling from the machine config', () => {
    const { deps } = fakeDeps()
    expect(stepWatchFor({}, limitsOf(OWNER_CEILING), deps).ceilingUsd).toBe(4)
  })

  it('takes --max-cost over the machine config', () => {
    const { deps } = fakeDeps()
    expect(stepWatchFor({ 'max-cost': '1.5' }, limitsOf(OWNER_CEILING), deps).ceilingUsd).toBe(1.5)
  })

  it('fails on a bad --max-cost', () => {
    const { deps } = fakeDeps()
    expect(() => stepWatchFor({ 'max-cost': '0' }, limitsOf(NO_CONFIGS), deps)).toThrow(
      '--max-cost',
    )
  })

  it('writes progress through the injected writer, and reads time from the tracker clock', () => {
    const { deps, progress } = fakeDeps()
    const watch = stepWatchFor({}, limitsOf(NO_CONFIGS), deps)
    watch.write?.('line\n')
    expect(progress).toHaveBeenCalledWith('line\n')
    expect(watch.now()).toBe(5000)
  })

  it('has no writer with --quiet', () => {
    const { deps } = fakeDeps()
    expect(stepWatchFor({ quiet: true }, limitsOf(NO_CONFIGS), deps).write).toBeUndefined()
  })
})
