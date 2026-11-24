import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { NO_CONFIGS, type RepoConfig, type RepoConfigs } from './rules/config.mts'
import type { ReviewTarget } from './targets.mts'
import { filterTargets, resolveTargets } from './targets-settings.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function refsDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'targets-settings-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'targets'), { recursive: true })
  writeFileSync(join(dir, 'targets', 'alpha.md'), '---\nname: alpha\nwhen: A.\n---\nCheck A.\n')
  writeFileSync(join(dir, 'targets', 'beta.md'), '---\nname: beta\nwhen: B.\n---\nCheck B.\n')
  return dir
}

const cfg = (disabled?: string[] | 'all'): RepoConfig => ({
  consumes: [],
  ...(disabled === undefined ? {} : { targets: { disabled } }),
  problems: [],
})

describe('resolveTargets', () => {
  it('enables all targets in the given references directory by default', () => {
    expect(resolveTargets(NO_CONFIGS, 'acme/app', undefined, refsDir())).toEqual({
      disabled: [],
      enabled: ['alpha', 'beta'],
      from: 'default',
    })
  })

  it('precedence is machine repo > machine owner > repository file', () => {
    const refs = refsDir()
    const repoFile = cfg(['alpha'])
    expect(resolveTargets(NO_CONFIGS, 'acme/app', repoFile, refs)).toEqual({
      disabled: ['alpha'],
      enabled: ['beta'],
      from: 'repository file',
    })
    const withOwner: RepoConfigs = {
      ...NO_CONFIGS,
      byOwner: new Map([['acme', cfg('all')]]),
    }
    expect(resolveTargets(withOwner, 'acme/app', repoFile, refs)).toEqual({
      disabled: 'all',
      enabled: [],
      from: 'machine owner',
    })
    const withRepo: RepoConfigs = {
      ...withOwner,
      byRepo: new Map([['acme/app', cfg([])]]),
    }
    expect(resolveTargets(withRepo, 'acme/app', repoFile, refs)).toEqual({
      disabled: [],
      enabled: ['alpha', 'beta'],
      from: 'machine repo',
    })
  })
})

describe('filterTargets', () => {
  const all: ReviewTarget[] = [
    { name: 'alpha', when: 'A.', point: 'Check A.' },
    { name: 'beta', when: 'B.', point: 'Check B.' },
  ]

  it('keeps all by default, removes disabled names, or clears all', () => {
    expect(filterTargets(all)).toEqual(all)
    expect(filterTargets(all, { disabled: ['alpha'] })).toEqual([all[1]])
    expect(filterTargets(all, { disabled: 'all' })).toEqual([])
  })
})
