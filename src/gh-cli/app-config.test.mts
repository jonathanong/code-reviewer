import { describe, expect, it, vi } from 'vitest'

import { AppAuthError } from './app-auth.mts'
import { loadAppConfig, realAppConfigFs, type AppConfigFs } from './app-config.mts'

const PEM = '-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----'
const DIR = '/cfg'
const FILE = '/cfg/app.json'

/** In-memory files: path to text, with an optional permission mode (default owner-only). */
function memoryFs(files: Record<string, string>, modes: Record<string, number> = {}): AppConfigFs {
  return {
    readText: vi.fn((path: string) => files[path]),
    mode: vi.fn((path: string) => modes[path] ?? 0o600),
  }
}

const load = (
  files: Record<string, string>,
  env = {},
  modes = {},
  platform: NodeJS.Platform = 'linux',
) => loadAppConfig({ HOME: '/home/u', ...env }, memoryFs(files, modes), DIR, platform)

describe('loadAppConfig from the environment', () => {
  it('returns undefined with no env App and no app.json', () => {
    expect(load({})).toBeUndefined()
    expect(load({}, { CODE_REVIEWER_APP_ID: '  ' })).toBeUndefined()
  })

  it('reads the key from the environment and defaults the API url', () => {
    expect(load({}, { CODE_REVIEWER_APP_ID: ' 9 ', CODE_REVIEWER_APP_PRIVATE_KEY: PEM })).toEqual({
      appId: '9',
      privateKey: PEM,
      apiUrl: 'https://api.github.com',
      source: 'env',
    })
  })

  it('reads the key from a path, the installation id, and strips trailing slashes', () => {
    expect(
      load(
        { '/k.pem': PEM },
        {
          CODE_REVIEWER_APP_ID: '9',
          CODE_REVIEWER_APP_PRIVATE_KEY_PATH: ' /k.pem ',
          CODE_REVIEWER_APP_INSTALLATION_ID: ' 77 ',
          GITHUB_API_URL: 'https://ghe.test/api///',
        },
      ),
    ).toEqual({
      appId: '9',
      privateKey: PEM,
      installationId: '77',
      apiUrl: 'https://ghe.test/api',
      source: 'env',
    })
  })

  it('wins over app.json', () => {
    const config = load(
      { [FILE]: '{"appId":"1"}', '/cfg/app.pem': PEM },
      { CODE_REVIEWER_APP_ID: '2', CODE_REVIEWER_APP_PRIVATE_KEY: PEM },
    )
    expect(config).toMatchObject({ appId: '2', source: 'env' })
  })

  it('fails fast without a key, with a key that is not a PEM, or with a bad key file', () => {
    const env = { CODE_REVIEWER_APP_ID: '9' }
    expect(() => load({}, env)).toThrow(AppAuthError)
    expect(() => load({}, { ...env, CODE_REVIEWER_APP_PRIVATE_KEY: 'nope' })).toThrow(AppAuthError)
    expect(() => load({}, { ...env, CODE_REVIEWER_APP_PRIVATE_KEY_PATH: '/missing.pem' })).toThrow(
      /\/missing\.pem: private key file does not exist/u,
    )
  })
})

describe('loadAppConfig from app.json', () => {
  it('reads app.pem beside it by default and takes a numeric appId', () => {
    expect(load({ [FILE]: '{"appId":123}', '/cfg/app.pem': PEM })).toEqual({
      appId: '123',
      privateKey: PEM,
      apiUrl: 'https://api.github.com',
      source: FILE,
    })
  })

  it('resolves privateKeyPath against the directory, an absolute path, and ~/', () => {
    const at = (privateKeyPath: string, files: Record<string, string>) =>
      load({
        [FILE]: JSON.stringify({ appId: 'a', privateKeyPath, installationId: 5 }),
        ...files,
      })
    expect(at('keys/my.pem', { '/cfg/keys/my.pem': PEM })).toMatchObject({
      privateKey: PEM,
      installationId: '5',
    })
    expect(at('/abs/my.pem', { '/abs/my.pem': PEM })?.privateKey).toBe(PEM)
    expect(at('~/my.pem', { '/home/u/my.pem': PEM })?.privateKey).toBe(PEM)
  })

  it('falls back to the OS home directory when HOME is unset', () => {
    const files = { [FILE]: '{"appId":"a","privateKeyPath":"~/k.pem"}' }
    expect(() => loadAppConfig({}, memoryFs(files), DIR, 'linux')).toThrow(/k\.pem/u)
  })

  it('fails fast on malformed JSON, a non-object, an unknown key, and bad values', () => {
    const problem = (text: string, files = {}) =>
      expect(() => load({ [FILE]: text, ...files })).toThrow(
        expect.objectContaining({ name: 'AppAuthError', message: expect.stringContaining(FILE) }),
      )
    problem('{nope')
    problem('[]')
    problem('null')
    problem('{"appId":"1","privateKey":"x"}')
    problem('{}')
    problem('{"appId":"  "}')
    problem('{"appId":true}')
    problem('{"appId":"1","installationId":""}')
    problem('{"appId":"1","privateKeyPath":""}')
    problem('{"appId":"1","privateKeyPath":3}')
  })

  it('fails fast when the key file is missing, unreadable, or not a PEM', () => {
    expect(() => load({ [FILE]: '{"appId":"1"}' })).toThrow(
      /\/cfg\/app\.pem: private key file does not exist/u,
    )
    expect(() => load({ [FILE]: '{"appId":"1"}', '/cfg/app.pem': 'hello' })).toThrow(
      /not a PEM private key/u,
    )
    const unreadable: AppConfigFs = {
      readText: (path) => {
        if (path === FILE) return '{"appId":"1"}'
        throw new Error('EACCES')
      },
      mode: () => 0o600,
    }
    expect(() => loadAppConfig({}, unreadable, DIR, 'linux')).toThrow(/cannot be read \(EACCES\)/u)
  })

  it('fails fast when the key file is readable by group or others, except on Windows', () => {
    const files = { [FILE]: '{"appId":"1"}', '/cfg/app.pem': PEM }
    expect(() => load(files, {}, { '/cfg/app.pem': 0o640 })).toThrow(/chmod 600/u)
    expect(() => load(files, {}, { '/cfg/app.pem': 0o604 })).toThrow(/chmod 600/u)
    expect(load(files, {}, { '/cfg/app.pem': 0o400 })?.privateKey).toBe(PEM)
    expect(load(files, {}, { '/cfg/app.pem': 0o666 }, 'win32')?.privateKey).toBe(PEM)
  })
})

describe('loadAppConfig defaults', () => {
  it('uses the machine config directory and the real file system', () => {
    const config = loadAppConfig({ CODE_REVIEWER_CONFIG_DIR: '/nonexistent/code-reviewer' })
    expect(config).toBeUndefined()
  })

  it('reads the real file system for a missing file and reports other errors', () => {
    expect(realAppConfigFs.readText('/nonexistent/app.json')).toBeUndefined()
    expect(() => realAppConfigFs.readText('/')).toThrow(/EISDIR/u)
    expect(realAppConfigFs.mode('/')).toBeTypeOf('number')
  })
})
