import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import {
  AppAuthError,
  createAppJwt,
  createInstallationTokenProvider,
  loadAppConfig,
  type AppConfig,
  type FetchJson,
} from './app-auth.mts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const CONFIG: AppConfig = { appId: '123', privateKey, apiUrl: 'https://api.test' }

describe('loadAppConfig', () => {
  it('returns undefined without an app id', () => {
    expect(loadAppConfig({})).toBeUndefined()
    expect(loadAppConfig({ FINAL_REVIEWER_APP_ID: '  ' })).toBeUndefined()
  })

  it('reads the key from the environment and defaults the API url', () => {
    expect(
      loadAppConfig({ FINAL_REVIEWER_APP_ID: ' 9 ', FINAL_REVIEWER_APP_PRIVATE_KEY: privateKey }),
    ).toEqual({ appId: '9', privateKey, apiUrl: 'https://api.github.com' })
  })

  it('reads the key from a path, the installation id, and strips trailing slashes', () => {
    const readFile = vi.fn(() => privateKey)
    expect(
      loadAppConfig(
        {
          FINAL_REVIEWER_APP_ID: '9',
          FINAL_REVIEWER_APP_PRIVATE_KEY_PATH: ' /k.pem ',
          FINAL_REVIEWER_APP_INSTALLATION_ID: ' 77 ',
          GITHUB_API_URL: 'https://ghe.test/api///',
        },
        readFile,
      ),
    ).toEqual({ appId: '9', privateKey, installationId: '77', apiUrl: 'https://ghe.test/api' })
    expect(readFile).toHaveBeenCalledWith('/k.pem')
  })

  it('reads real files by default', () => {
    expect(() =>
      loadAppConfig({
        FINAL_REVIEWER_APP_ID: '9',
        FINAL_REVIEWER_APP_PRIVATE_KEY_PATH: '/nonexistent/k.pem',
      }),
    ).toThrow(/ENOENT/u)
  })

  it('rejects a missing or invalid key', () => {
    expect(() => loadAppConfig({ FINAL_REVIEWER_APP_ID: '9' })).toThrow(AppAuthError)
    expect(() =>
      loadAppConfig({ FINAL_REVIEWER_APP_ID: '9', FINAL_REVIEWER_APP_PRIVATE_KEY: 'nope' }),
    ).toThrow(/no PEM private key/u)
  })
})

describe('createAppJwt', () => {
  it('signs a backdated ten-minute RS256 token', () => {
    const jwt = createAppJwt('123', privateKey, 1_000)
    const [header, payload, signature] = jwt.split('.') as [string, string, string]
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({
      alg: 'RS256',
      typ: 'JWT',
    })
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iat: 940,
      exp: 1_540,
      iss: '123',
    })
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${header}.${payload}`)
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
  })
})

type Reply = { ok?: boolean; status?: number; body?: unknown }

function fakeFetch(reply: (url: string, method: string) => Reply) {
  return vi.fn<FetchJson>(async (url, init) => {
    const { ok = true, status = 200, body = {} } = reply(url, init.method)
    return { ok, status, json: async () => body }
  })
}

const expiry = (ms: number) => new Date(ms).toISOString()

describe('createInstallationTokenProvider', () => {
  const T0 = Date.parse('2026-01-01T00:00:00Z')

  it('looks up the installation by repository, mints, and sends a signed JWT', async () => {
    const fetchJson = fakeFetch((url) =>
      url.endsWith('/installation')
        ? { body: { id: 42 } }
        : { body: { token: 'tok', expires_at: expiry(T0 + 3_600_000) } },
    )
    const provider = createInstallationTokenProvider(CONFIG, fetchJson, () => T0)
    await expect(provider('o', 'r')).resolves.toBe('tok')
    expect(fetchJson.mock.calls.map(([url, init]) => `${init.method} ${url}`)).toEqual([
      'GET https://api.test/repos/o/r/installation',
      'POST https://api.test/app/installations/42/access_tokens',
    ])
    const auth = fetchJson.mock.calls[0]![1].headers.authorization as string
    expect(auth).toMatch(/^Bearer /u)
    const [h, p, s] = auth.slice(7).split('.') as [string, string, string]
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${h}.${p}`)
    expect(verifier.verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })

  it('looks up the organization installation when no repo is given, caching per owner', async () => {
    const fetchJson = fakeFetch((url) =>
      url.endsWith('/installation')
        ? { body: { id: 5 } }
        : { body: { token: 'org', expires_at: expiry(T0 + 3_600_000) } },
    )
    const provider = createInstallationTokenProvider(CONFIG, fetchJson, () => T0)
    await provider('acme')
    await provider('acme', 'widgets')
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([
      'https://api.test/orgs/acme/installation',
      'https://api.test/app/installations/5/access_tokens',
    ])
  })

  it('uses a pinned installation without a lookup', async () => {
    const fetchJson = fakeFetch(() => ({
      body: { token: 'pin', expires_at: expiry(T0 + 3_600_000) },
    }))
    const provider = createInstallationTokenProvider(
      { ...CONFIG, installationId: '8' },
      fetchJson,
      () => T0,
    )
    await expect(provider('o', 'r')).resolves.toBe('pin')
    expect(fetchJson).toHaveBeenCalledOnce()
    expect(fetchJson.mock.calls[0]![0]).toBe('https://api.test/app/installations/8/access_tokens')
  })

  it('caches the token until five minutes before expiry, then re-mints', async () => {
    let now = T0
    let n = 0
    const fetchJson = fakeFetch(() => ({
      body: { token: `t${++n}`, expires_at: expiry(T0 + 3_600_000) },
    }))
    const provider = createInstallationTokenProvider(
      { ...CONFIG, installationId: '8' },
      fetchJson,
      () => now,
    )
    await expect(provider('o')).resolves.toBe('t1')
    now = T0 + 3_600_000 - 5 * 60_000 - 1
    await expect(provider('o')).resolves.toBe('t1')
    now = T0 + 3_600_000 - 5 * 60_000
    await expect(provider('o')).resolves.toBe('t2')
    expect(fetchJson).toHaveBeenCalledTimes(2)
  })

  it('defaults to the global fetch and clock', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ token: 'g', expires_at: expiry(Date.now() + 3_600_000) })),
      )
    const provider = createInstallationTokenProvider({ ...CONFIG, installationId: '1' })
    await expect(provider('o')).resolves.toBe('g')
    fetchSpy.mockRestore()
  })

  it('rejects non-ok responses with the status', async () => {
    const lookup = createInstallationTokenProvider(
      CONFIG,
      fakeFetch(() => ({ ok: false, status: 404 })),
      () => T0,
    )
    await expect(lookup('o', 'r')).rejects.toThrow(
      'GitHub App request GET /repos/o/r/installation failed with 404.',
    )
    const mint = createInstallationTokenProvider(
      { ...CONFIG, installationId: '8' },
      fakeFetch(() => ({ ok: false, status: 401 })),
      () => T0,
    )
    await expect(mint('o')).rejects.toBeInstanceOf(AppAuthError)
  })

  it('rejects a token response without a token', async () => {
    const provider = createInstallationTokenProvider(
      { ...CONFIG, installationId: '8' },
      fakeFetch(() => ({ body: { expires_at: expiry(T0) } })),
      () => T0,
    )
    await expect(provider('o')).rejects.toThrow('GitHub App token response had no token.')
    const noExpiry = createInstallationTokenProvider(
      { ...CONFIG, installationId: '8' },
      fakeFetch(() => ({ body: { token: 'x' } })),
      () => T0,
    )
    await expect(noExpiry('o')).rejects.toBeInstanceOf(AppAuthError)
  })
})
