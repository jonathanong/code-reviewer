import { describe, expect, it, vi } from 'vitest'

import { runLoopCommand } from './command-loop.mts'
import { fakeDeps } from './command-loop-fake-io.mts'

const target = () => ({ repo: 'acme/widgets', pr: 1 })

describe('auth for an owner', () => {
  it('reports gh for an owner the App is not installed for, and app where it is', async () => {
    const authModeFor = vi.fn(async () => 'gh' as const)
    const off = {
      ...fakeDeps().deps,
      authModeFor,
      authIdentity: vi.fn(async () => ({ appInstalled: false as const })),
    }
    await expect(runLoopCommand('auth', { owner: 'acme' }, target, off)).resolves.toEqual({
      mode: 'gh',
      appInstalled: false,
    })
    expect(authModeFor).toHaveBeenCalledWith('acme', undefined)
    const authIdentity = vi.fn(async () => ({ login: 'my-app[bot]' }))
    const on = { ...fakeDeps().deps, authIdentity }
    await expect(runLoopCommand('auth', { repo: ['acme/widgets'] }, target, on)).resolves.toEqual({
      mode: 'app',
      login: 'my-app[bot]',
    })
    expect(authIdentity).toHaveBeenCalledWith('acme', 'widgets')
  })
})
