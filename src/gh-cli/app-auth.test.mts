import { createVerify, generateKeyPairSync } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'

import {
  AppAuthError,
  createAppIdentityProvider,
  createAppJwt,
  createInstallationTokenProvider,
  type AppConfig,
  type FetchJson,
} from './app-auth.mts'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
})

const CONFIG: AppConfig = { appId: '123', privateKey, apiUrl: 'https://api.test', source: 'env' }

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

  it('falls back to the user installation when the org endpoint 404s', async () => {
    const fetchJson = fakeFetch((url) => {
      if (url.includes('/orgs/')) return { ok: false, status: 404 }
      return url.endsWith('/installation')
        ? { body: { id: 9 } }
        : { body: { token: 'usr', expires_at: expiry(T0 + 3_600_000) } }
    })
    const provider = createInstallationTokenProvider(CONFIG, fetchJson, () => T0)
    await expect(provider('jane')).resolves.toBe('usr')
    expect(fetchJson.mock.calls.map(([url]) => url)).toEqual([
      'https://api.test/orgs/jane/installation',
      'https://api.test/users/jane/installation',
      'https://api.test/app/installations/9/access_tokens',
    ])
  })

  it('does not fall back on other org lookup failures or a second 404', async () => {
    const denied = fakeFetch(() => ({ ok: false, status: 403 }))
    await expect(createInstallationTokenProvider(CONFIG, denied, () => T0)('acme')).rejects.toThrow(
      'failed with 403',
    )
    expect(denied).toHaveBeenCalledOnce()
    const missing = fakeFetch(() => ({ ok: false, status: 404 }))
    await expect(
      createInstallationTokenProvider(CONFIG, missing, () => T0)('nobody'),
    ).rejects.toThrow('GET /users/nobody/installation failed with 404')
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

describe('createAppIdentityProvider', () => {
  const answer = (slug: unknown, ok = true): FetchJson =>
    vi.fn(async () => ({ ok, status: ok ? 200 : 401, json: async () => ({ slug }) }))

  it('looks the App up with its JWT and returns <slug>[bot], once per process', async () => {
    const fetchJson = answer('my-app')
    const identity = createAppIdentityProvider(CONFIG, fetchJson, () => 1_000_000)
    await expect(identity()).resolves.toBe('my-app[bot]')
    await expect(identity()).resolves.toBe('my-app[bot]')
    expect(fetchJson).toHaveBeenCalledOnce()
    const [url, init] = vi.mocked(fetchJson).mock.calls[0]!
    expect(url).toBe('https://api.test/app')
    expect(init.method).toBe('GET')
    const jwt = init.headers.authorization?.replace('Bearer ', '') ?? ''
    const [header, payload, signature] = jwt.split('.') as [string, string, string]
    const verifier = createVerify('RSA-SHA256').update(`${header}.${payload}`)
    expect(verifier.verify(publicKey, Buffer.from(signature, 'base64url'))).toBe(true)
  })

  it('rejects on a failed or slugless response and tries again next time', async () => {
    await expect(createAppIdentityProvider(CONFIG, answer('x', false))()).rejects.toMatchObject({
      status: 401,
    })
    await expect(createAppIdentityProvider(CONFIG, answer(''))()).rejects.toBeInstanceOf(
      AppAuthError,
    )
    const flaky = vi
      .fn<FetchJson>()
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ slug: 'a' }) })
    const identity = createAppIdentityProvider(CONFIG, flaky)
    await expect(identity()).rejects.toBeInstanceOf(AppAuthError)
    await expect(identity()).resolves.toBe('a[bot]')
  })

  it('defaults to the global fetch and the clock', () => {
    expect(createAppIdentityProvider(CONFIG)).toBeTypeOf('function')
  })
})
