import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppNotInstalledError } from '../gh-cli/index.mts'
import { runReviewCommand } from './command.mts'
import type { ReviewDeps } from './deps.mts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('code-reviewer auth --owner', () => {
  it('prints installationError and exits 1 when the App is not installed, 0 when it is', async () => {
    const out: string[] = []
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => (out.push(String(chunk)), true))
    const missing = new AppNotInstalledError('acme', undefined, undefined)
    const make = (error?: Error) =>
      ({
        authMode: () => 'app',
        authIdentity: async () => ({}),
        checkInstallation: async () => {
          if (error !== undefined) throw error
        },
      }) as unknown as ReviewDeps
    await expect(runReviewCommand(['auth', '--owner', 'acme'], make(missing))).resolves.toBe(1)
    expect(JSON.parse(out.join(''))).toEqual({ mode: 'app', installationError: missing.message })
    out.length = 0
    await expect(runReviewCommand(['auth', '--owner', 'acme'], make())).resolves.toBe(0)
    expect(JSON.parse(out.join(''))).toEqual({ mode: 'app' })
  })

  it.each([
    ['claim', ['--repo', 'acme/w', '--pr', '1']],
    ['review', ['--repo', 'acme/w', '--pr', '1']],
    ['post', ['--repo', 'acme/w', '--pr', '1']],
    ['carry', ['--repo', 'acme/w', '--pr', '1']],
    ['status', ['--repo', 'acme/w', '--pr', '1']],
    ['queue', ['--owner', 'acme']],
  ])('%s fails on a missing installation before doing any work', async (subcommand, flags) => {
    const missing = new AppNotInstalledError('acme', undefined, undefined)
    const work = vi.fn()
    const err: string[] = []
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => (err.push(String(chunk)), true))
    const deps = {
      authMode: () => 'app',
      authIdentity: async () => ({}),
      checkInstallation: async () => {
        throw missing
      },
      createIo: work,
      createLabelIo: work,
      createPrepareIo: work,
      runner: work,
      targetConfig: work,
      configs: work,
      exec: work,
    } as unknown as ReviewDeps
    await expect(runReviewCommand([subcommand, ...flags], deps)).resolves.toBe(2)
    expect(err.join('')).toContain(missing.message)
    expect(work).not.toHaveBeenCalled()
  })
})
