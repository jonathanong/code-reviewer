import { afterEach, describe, expect, it, vi } from 'vitest'

import { appRunner, createGhAuth, splitRepo } from './auth.mts'
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
    await expect(auth.modeFor('o', 'r')).resolves.toBe('gh')
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

  it('defaults to process.env and the real token provider', () => {
    vi.stubEnv('XDG_CONFIG_HOME', NO_CONFIG)
    vi.stubEnv('CODE_REVIEWER_APP_ID', '')
    expect(createGhAuth().mode).toBe('gh')
    vi.stubEnv('CODE_REVIEWER_APP_ID', '5')
    vi.stubEnv('CODE_REVIEWER_APP_PRIVATE_KEY', KEY)
    expect(createGhAuth().mode).toBe('app')
  })
})

describe('an owner without an installation', () => {
  it('is gh mode for that owner only', async () => {
    const tokens = vi.fn(async (owner: string) => (owner === 'off' ? undefined : 'tok'))
    const auth = createGhAuth(
      { CODE_REVIEWER_APP_ID: '1', CODE_REVIEWER_APP_PRIVATE_KEY: KEY },
      () => tokens,
      () => async () => 'my-app[bot]',
    )
    expect(auth.mode).toBe('app')
    await expect(auth.modeFor('off', 'r')).resolves.toBe('gh')
    await expect(auth.modeFor('on', 'r')).resolves.toBe('app')
  })
})

describe('appRunner', () => {
  it('runs plain gh without the App token when the App is not installed', async () => {
    vi.stubEnv('GH_TOKEN', 'ambient')
    const exec = vi.fn<ExecFileText>(async () => ({ stdout: 'out' }))
    await expect(appRunner(async () => undefined, 'o', 'r', exec)(['pr', 'view'])).resolves.toBe(
      'out',
    )
    const [command, args, options] = exec.mock.calls[0]!
    expect([command, args]).toEqual(['gh', ['pr', 'view']])
    expect(options?.env.GH_TOKEN).toBe('ambient')
  })

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
