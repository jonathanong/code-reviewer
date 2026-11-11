import { afterEach, describe, expect, it, vi } from 'vitest'

import { appRunner, createGhAuth, splitRepo } from './auth.mts'
import { runGh, type ExecFileText } from './exec.mts'

const KEY = '-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('createGhAuth', () => {
  it('uses the local gh login without App credentials', () => {
    const tokensFor = vi.fn()
    const auth = createGhAuth({}, tokensFor)
    expect(auth.mode).toBe('gh')
    expect(auth.runner('o', 'r')).toBe(runGh)
    expect(tokensFor).not.toHaveBeenCalled()
  })

  it('uses App auth when configured', () => {
    const tokens = vi.fn(async () => 'app-token')
    const tokensFor = vi.fn(() => tokens)
    const auth = createGhAuth(
      { FINAL_REVIEWER_APP_ID: '1', FINAL_REVIEWER_APP_PRIVATE_KEY: KEY },
      tokensFor,
    )
    expect(auth.mode).toBe('app')
    expect(tokensFor).toHaveBeenCalledWith(expect.objectContaining({ appId: '1' }))
    expect(auth.runner('o', 'r')).toBeTypeOf('function')
  })

  it('defaults to process.env and the real token provider', () => {
    vi.stubEnv('FINAL_REVIEWER_APP_ID', '')
    expect(createGhAuth().mode).toBe('gh')
    vi.stubEnv('FINAL_REVIEWER_APP_ID', '5')
    vi.stubEnv('FINAL_REVIEWER_APP_PRIVATE_KEY', KEY)
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
