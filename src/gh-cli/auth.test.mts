import { afterEach, describe, expect, it, vi } from 'vitest'

import { appRunner, createGhAuth, splitRepo } from './auth.mts'
import { AppNotInstalledError } from './app-auth.mts'
import { runGh, type ExecFileText } from './exec.mts'

const NO_CONFIG = '/nonexistent/code-reviewer'
const KEY = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createGhAuth', () => {
  it('uses the local gh login without App credentials', async () => {
    const tokensFor = vi.fn()
    const auth = createGhAuth({ XDG_CONFIG_HOME: NO_CONFIG }, tokensFor)
    expect(auth.mode).toBe('gh')
    await expect(auth.identity()).resolves.toBeUndefined()
    expect(auth.runner('o', 'r')).toBe(runGh)
    expect(tokensFor).not.toHaveBeenCalled()
  })

  it('uses App auth when configured', async () => {
    const tokens = vi.fn(async () => 'app-token')
    const tokensFor = vi.fn(() => tokens)
    const identityFor = vi.fn(() => async () => 'my-app[bot]')
    const auth = createGhAuth(
      { CODE_REVIEWER_APP_ID: '1', CODE_REVIEWER_APP_PRIVATE_KEY: KEY },
      tokensFor,
      identityFor,
    )
    expect(auth.mode).toBe('app')
    expect(auth.source).toBe('env')
    expect(identityFor).toHaveBeenCalledWith(expect.objectContaining({ appId: '1' }))
    await expect(auth.identity()).resolves.toBe('my-app[bot]')
    expect(tokensFor).toHaveBeenCalledWith(expect.objectContaining({ appId: '1' }))
    expect(auth.runner('o', 'r')).toBeTypeOf('function')
  })

  it('checks the installation through the token provider under App auth only', async () => {
    const notInstalled = new AppNotInstalledError('acme', undefined, undefined)
    const tokens = vi.fn(async (owner: string) => {
      if (owner === 'acme') throw notInstalled
      return 'tok'
    })
    const auth = createGhAuth(
      { CODE_REVIEWER_APP_ID: '1', CODE_REVIEWER_APP_PRIVATE_KEY: KEY },
      () => tokens,
      () => async () => 'my-app[bot]',
    )
    await expect(auth.checkInstallation('o', 'r')).resolves.toBeUndefined()
    expect(tokens).toHaveBeenCalledWith('o', 'r')
    await expect(auth.checkInstallation('acme')).rejects.toBe(notInstalled)
    const plain = createGhAuth({ XDG_CONFIG_HOME: NO_CONFIG })
    await expect(plain.checkInstallation('acme')).resolves.toBeUndefined()
  })

  it('defaults to process.env and the real token provider', () => {
    vi.stubEnv('XDG_CONFIG_HOME', NO_CONFIG)
    vi.stubEnv('CODE_REVIEWER_APP_ID', '')
    expect(createGhAuth().mode).toBe('gh')
    vi.stubEnv('CODE_REVIEWER_APP_ID', '5')
    vi.stubEnv('CODE_REVIEWER_APP_PRIVATE_KEY', KEY)
    expect(createGhAuth().mode).toBe('app')
  })
})

describe('appRunner', () => {
  it('runs gh with GH_TOKEN and without CLICOLOR_FORCE', async () => {
    vi.stubEnv('CLICOLOR_FORCE', '1')
    const tokens = vi.fn(async () => 'tok')
    const exec = vi.fn<ExecFileText>(async () => ({ stdout: 'out' }))
    await expect(appRunner(tokens, 'o', 'r', exec)(['api', 'x'])).resolves.toBe('out')
    expect(tokens).toHaveBeenCalledWith('o', 'r')
    const [command, args, options] = exec.mock.calls[0]!
    expect(command).toBe('gh')
    expect(args).toEqual(['api', 'x'])
    expect(options?.env.GH_TOKEN).toBe('tok')
    expect(options?.env).not.toHaveProperty('CLICOLOR_FORCE')
  })

  it('looks the token up per call', async () => {
    const tokens = vi.fn(async () => 't')
    const exec = vi.fn<ExecFileText>(async () => ({ stdout: '' }))
    const run = appRunner(tokens, 'o', undefined, exec)
    await run([])
    await run([])
    expect(tokens).toHaveBeenCalledTimes(2)
    expect(tokens).toHaveBeenCalledWith('o', undefined)
  })
})

describe('splitRepo', () => {
  it('splits owner and name, tolerating missing parts', () => {
    expect(splitRepo('acme/widgets')).toEqual({ owner: 'acme', name: 'widgets' })
    expect(splitRepo('acme')).toEqual({ owner: 'acme', name: '' })
    expect(splitRepo('')).toEqual({ owner: '', name: '' })
  })
})
