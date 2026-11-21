import { describe, expect, it, vi } from 'vitest'

import type { ReviewDeps } from '../cli/deps.mts'
import { parseRepoConfig, type RepoConfigs } from '../review/rules/config.mts'
import { checkPreconditions } from './preflight.mts'

const OWN = parseRepoConfig(
  '{"rulePlugins":["own-rules"]}',
  'acme/widgets/.code-reviewer.json',
  'trusted',
)

function depsFor(machine: object, installed: string[]) {
  const configs: RepoConfigs = {
    byOwner: new Map(),
    byRepo: new Map([
      ['acme/widgets', parseRepoConfig(JSON.stringify(machine), 'acme/widgets.json')],
    ]),
    problems: [],
  }
  return {
    configs: () => configs,
    targetConfig: vi.fn(async () => ({ config: OWN, problems: [] })),
    pluginInfo: vi.fn(async () => ({
      enabled: [],
      installs: installed.map((name) => ({ name, installPath: `/p/${name}` })),
    })),
    authIdentity: vi.fn(async () => ({})),
    checkInstallation: vi.fn(async () => undefined),
  } as unknown as ReviewDeps
}

describe('checkPreconditions with a trusted repository file', () => {
  it('needs the plugin its own file names to be installed already', async () => {
    const deps = depsFor({ trustRepoConfig: true }, ['no-mistakes-rules', 'jong-skills'])
    await expect(checkPreconditions(deps, 'acme/widgets')).rejects.toMatchObject({
      message: 'rule plugins missing or not enabled at user scope: own-rules',
    })
  })

  it('passes once that plugin is installed', async () => {
    const deps = depsFor({ trustRepoConfig: true }, ['own-rules'])
    await expect(checkPreconditions(deps, 'acme/widgets')).resolves.toBeUndefined()
  })

  it('ignores the repository file without trust, so the defaults apply', async () => {
    const deps = depsFor({}, ['no-mistakes-rules', 'jong-skills'])
    await expect(checkPreconditions(deps, 'acme/widgets')).resolves.toBeUndefined()
  })
})
