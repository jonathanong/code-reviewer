import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../review/run/review.mts', () => ({
  runReview: vi.fn(async () => ({ ok: true, summary: { claimed: true, mode: 'full' } })),
}))
vi.mock('../tracker/record.mts', () => ({
  recordReview: vi.fn(() => ({})),
  recordStoppedReview: vi.fn(),
}))

import {
  loadRepoConfigs,
  NO_CONFIGS,
  parseRepoConfig,
  type RepoConfig,
  type RepoConfigs,
} from '../review/rules/config.mts'
import { targetNamesIn } from '../review/targets.mts'
import { runReview, type ReviewSteps } from '../review/run/review.mts'
import { runLoopCommand } from './command-loop.mts'
import type { ReviewDeps } from './deps.mts'
import { reviewCommand } from './command-review.mts'

const TARGET = { repo: 'acme/widgets', pr: 4 }
const target = () => TARGET
const dirs: string[] = []

function customRefs(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cli-targets-refs-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'targets'), { recursive: true })
  writeFileSync(
    join(dir, 'targets', 'custom-guard.md'),
    '---\nname: custom-guard\nwhen: Custom.\n---\nCheck custom.\n',
  )
  return dir
}

function makeDeps(configs: RepoConfigs, references: string, own?: RepoConfig): ReviewDeps {
  return {
    configs: () => configs,
    targetConfig: async () => ({ config: own, problems: own?.problems ?? [] }),
    tracker: () => ({ dir: '/state', now: () => new Date('2026-11-24T00:00:00Z') }),
    pluginInfo: async () => ({ enabled: [], installs: [] }),
    guideReader: () => async () => '',
    createIo: () => ({}),
    exec: async () => '',
    progress: () => undefined,
    references: () => references,
  } as unknown as ReviewDeps
}

afterEach(() => {
  vi.clearAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('targets config wiring in CLI commands', () => {
  it('validates, resolves, and passes targets using one explicit references directory', async () => {
    const refs = customRefs()
    const repoFile = parseRepoConfig(
      'targets:\n  disabled: [custom-guard]\n',
      '.code-reviewer.yaml',
      'target',
      targetNamesIn(refs),
    )
    expect(repoFile.problems).toEqual([])
    const printed = (await runLoopCommand(
      'settings',
      { repo: ['acme/widgets'] },
      target,
      makeDeps(NO_CONFIGS, refs, repoFile),
    )) as { targets: unknown }
    expect(printed.targets).toEqual({
      disabled: ['custom-guard'],
      enabled: [],
      from: 'repository file',
    })

    const cfgDir = mkdtempSync(join(tmpdir(), 'cli-targets-cfg-'))
    dirs.push(cfgDir)
    mkdirSync(join(cfgDir, 'acme'), { recursive: true })
    writeFileSync(join(cfgDir, 'acme', 'widgets.yaml'), 'targets:\n  disabled: [custom-guard]\n')
    const loaded = loadRepoConfigs(cfgDir, refs)
    expect(loaded.problems).toEqual([])
    await reviewCommand({ out: 'o', tree: 't' }, TARGET, makeDeps(loaded, refs))
    const wired = vi.mocked(runReview).mock.calls[0]?.[0] as ReviewSteps
    expect(wired.references).toBe(refs)
    expect(wired.targets).toEqual({ disabled: ['custom-guard'] })
  })

  it('stops before claiming on unknown target names in that references directory', async () => {
    const refs = customRefs()
    const bad = parseRepoConfig(
      'targets:\n  disabled: [no-such-target]\n',
      'acme/widgets.yaml',
      'repo',
      targetNamesIn(refs),
    )
    const badConfigs: RepoConfigs = {
      ...NO_CONFIGS,
      byRepo: new Map([['acme/widgets', bad]]),
      problems: bad.problems,
    }
    await expect(
      reviewCommand({ out: 'o', tree: 't' }, TARGET, makeDeps(badConfigs, refs)),
    ).rejects.toThrow(
      /settings invalid:.*acme\/widgets\.yaml targets\.disabled: unknown target "no-such-target"/u,
    )
    expect(runReview).not.toHaveBeenCalled()
  })
})
