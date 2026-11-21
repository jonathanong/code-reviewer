import { describe, expect, it, vi } from 'vitest'

import { NO_CONFIGS, parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import type { ReviewDeps } from './deps.mts'
import { stepWatchFor } from './step-watch-for.mts'

const OWNER_CEILING: RepoConfigs = {
  ...NO_CONFIGS,
  byOwner: new Map([
    ['acme', parseRepoConfig('{"limits":{"maxCostUsd":4}}', 'acme.json', 'owner')],
  ]),
}

function fakeDeps(configs: RepoConfigs = NO_CONFIGS) {
  const progress = vi.fn()
  const deps = {
    configs: () => configs,
    tracker: () => ({ now: () => new Date(5000) }),
    progress,
  } as unknown as ReviewDeps
  return { deps, progress }
}

describe('stepWatchFor', () => {
  it('has no ceiling when neither the flag nor a machine file sets one', () => {
    const { deps } = fakeDeps()
    expect(stepWatchFor({}, 'acme/widgets', deps).ceilingUsd).toBeUndefined()
  })

  it('takes the ceiling from the machine config', () => {
    const { deps } = fakeDeps(OWNER_CEILING)
    expect(stepWatchFor({}, 'acme/widgets', deps).ceilingUsd).toBe(4)
  })

  it('takes --max-cost over the machine config', () => {
    const { deps } = fakeDeps(OWNER_CEILING)
    expect(stepWatchFor({ 'max-cost': '1.5' }, 'acme/widgets', deps).ceilingUsd).toBe(1.5)
  })

  it('reads no config when the flag sets the ceiling', () => {
    const { deps } = fakeDeps()
    const configs = vi.spyOn(deps, 'configs')
    stepWatchFor({ 'max-cost': '2' }, 'acme/widgets', deps)
    expect(configs).not.toHaveBeenCalled()
  })

  it('fails on a bad --max-cost', () => {
    const { deps } = fakeDeps()
    expect(() => stepWatchFor({ 'max-cost': '0' }, 'acme/widgets', deps)).toThrow('--max-cost')
  })

  it('writes progress through the injected writer, and reads time from the tracker clock', () => {
    const { deps, progress } = fakeDeps()
    const watch = stepWatchFor({}, 'acme/widgets', deps)
    watch.write?.('line\n')
    expect(progress).toHaveBeenCalledWith('line\n')
    expect(watch.now()).toBe(5000)
  })

  it('has no writer with --quiet', () => {
    const { deps } = fakeDeps()
    expect(stepWatchFor({ quiet: true }, 'acme/widgets', deps).write).toBeUndefined()
  })
})
