import { describe, expect, it, vi } from 'vitest'

import type { ReviewDeps } from '../cli/deps.mts'
import { AppAuthError, AppNotInstalledError } from '../gh-cli/index.mts'
import { Precondition, checkPreconditions } from './preflight.mts'

function depsWith(checkInstallation: ReviewDeps['checkInstallation']) {
  const targetConfig = vi.fn(async () => ({ config: undefined, problems: [] }))
  const check = vi.fn(checkInstallation)
  const deps = {
    checkInstallation: check,
    targetConfig,
    configs: () => ({ byOwner: new Map(), byRepo: new Map(), problems: [] }),
    pluginInfo: async () => ({ enabled: [], installs: [] }),
    authIdentity: async () => ({}),
  } as unknown as ReviewDeps
  return { deps, targetConfig, check }
}

describe('checkPreconditions with the GitHub App', () => {
  it('fails as a precondition, before any read, when the App is not installed', async () => {
    const { deps, targetConfig, check } = depsWith(async () => {
      throw new AppNotInstalledError('acme', 'widgets', undefined)
    })
    const error = await checkPreconditions(deps, 'acme/widgets').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(Precondition)
    expect((error as Precondition).cause).toBeInstanceOf(AppNotInstalledError)
    expect(check).toHaveBeenCalledWith('acme', 'widgets')
    expect(targetConfig).not.toHaveBeenCalled()
  })

  it('treats a refused token as a precondition', async () => {
    const { deps } = depsWith(async () => {
      throw new AppAuthError('refused', 401)
    })
    await expect(checkPreconditions(deps, 'acme/widgets')).rejects.toBeInstanceOf(Precondition)
  })

  it('keeps a transient GitHub failure a plain failure, not a precondition', async () => {
    const { deps } = depsWith(async () => {
      throw new AppAuthError('unavailable', 503)
    })
    const error = await checkPreconditions(deps, 'acme/widgets').catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(AppAuthError)
    expect(error).not.toBeInstanceOf(Precondition)
  })
})
