import { describe, expect, it, vi } from 'vitest'

import { AppAuthError, AppNotInstalledError } from '../gh-cli/index.mts'
import { authCommand, requireApp } from './command-auth.mts'
import type { ReviewDeps } from './deps.mts'

function fake(checkInstallation: ReviewDeps['checkInstallation']) {
  const check = vi.fn(checkInstallation)
  const deps = {
    authMode: () => 'app',
    authIdentity: async () => ({ login: 'my-app[bot]' }),
    checkInstallation: check,
  } as unknown as ReviewDeps
  return { deps, check }
}

describe('authCommand', () => {
  it('reports the mode and identity, without an installation check when no scope is given', async () => {
    const { deps, check } = fake(async () => undefined)
    await expect(authCommand({}, deps)).resolves.toEqual({ mode: 'app', login: 'my-app[bot]' })
    expect(check).not.toHaveBeenCalled()
  })

  it('checks the owner or the repository it is given', async () => {
    const { deps, check } = fake(async () => undefined)
    await authCommand({ owner: 'acme' }, deps)
    expect(check).toHaveBeenLastCalledWith('acme', undefined)
    await expect(authCommand({ repo: ['acme/w'] }, deps)).resolves.toEqual({
      mode: 'app',
      login: 'my-app[bot]',
    })
    expect(check).toHaveBeenLastCalledWith('acme', 'w')
  })

  it('reports a scope the App is not installed for as installationError', async () => {
    const notInstalled = new AppNotInstalledError('acme', 'w', undefined)
    const { deps } = fake(async () => {
      throw notInstalled
    })
    await expect(authCommand({ repo: ['acme/w'] }, deps)).resolves.toEqual({
      mode: 'app',
      login: 'my-app[bot]',
      installationError: notInstalled.message,
    })
  })

  it('lets other installation failures propagate', async () => {
    const { deps } = fake(async () => {
      throw new AppAuthError('boom', 500)
    })
    await expect(authCommand({ owner: 'acme' }, deps)).rejects.toBeInstanceOf(AppAuthError)
  })
})

describe('requireApp', () => {
  const machine = (
    mode: 'app' | 'gh',
    check: ReviewDeps['checkInstallation'],
    loginError?: string,
  ) => {
    const checkInstallation = vi.fn(check)
    const deps = {
      authMode: () => mode,
      authIdentity: async () => (loginError === undefined ? {} : { loginError }),
      checkInstallation,
    } as unknown as ReviewDeps
    return { deps, check: checkInstallation }
  }

  it('does nothing under the gh login', async () => {
    const { deps, check } = machine('gh', async () => {
      throw new Error('unreachable')
    })
    await expect(requireApp({ owner: 'acme' }, deps, true)).resolves.toBeUndefined()
    expect(check).not.toHaveBeenCalled()
  })

  it('checks each distinct repository and owner once', async () => {
    const { deps, check } = machine('app', async () => undefined)
    await requireApp({ owner: 'acme', repo: ['acme/a', 'acme/a', 'acme/b'] }, deps, false)
    expect(check.mock.calls).toEqual([
      ['acme', 'a'],
      ['acme', 'b'],
      ['acme', undefined],
    ])
    await requireApp({}, deps, true)
    expect(check).toHaveBeenCalledTimes(3)
  })

  it('rethrows the not-installed error itself', async () => {
    const notInstalled = new AppNotInstalledError('acme', undefined, undefined)
    const { deps } = machine('app', async () => {
      throw notInstalled
    })
    await expect(requireApp({ owner: 'acme' }, deps, false)).rejects.toBe(notInstalled)
  })

  it('turns any other App failure into a configuration error keeping the cause', async () => {
    const refused = new AppAuthError('refused', 401)
    const { deps } = machine('app', async () => {
      throw refused
    })
    await expect(requireApp({ owner: 'acme' }, deps, false)).rejects.toMatchObject({
      cause: refused,
    })
    const error = await requireApp({ repo: ['acme/a'] }, deps, false).catch((c: unknown) => c)
    expect(error).not.toBeInstanceOf(AppAuthError)
    expect((error as Error).cause).toBe(refused)
  })

  it('leaves a transient failure as it is', async () => {
    const down = new AppAuthError('down', 503)
    const { deps } = machine('app', async () => {
      throw down
    })
    await expect(requireApp({ owner: 'acme' }, deps, false)).rejects.toBe(down)
    const offline = new TypeError('fetch failed')
    const { deps: net } = machine('app', async () => {
      throw offline
    })
    await expect(requireApp({ owner: 'acme' }, net, false)).rejects.toBe(offline)
  })

  it('fails when the App cannot look up its own login, only when asked for identity', async () => {
    const { deps } = machine('app', async () => undefined, 'own identity lookup failed')
    await expect(requireApp({ owner: 'acme' }, deps, false)).resolves.toBeUndefined()
    await expect(requireApp({ owner: 'acme' }, deps, true)).rejects.toBeInstanceOf(Error)
  })
})
