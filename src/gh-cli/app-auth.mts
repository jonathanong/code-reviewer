import { createSign } from 'node:crypto'

/** GitHub App credentials; without them every call uses the local `gh` login. */
export type AppConfig = {
  appId: string
  privateKey: string
  /** Fixed installation; otherwise it is looked up per repository owner. */
  installationId?: string
  apiUrl: string
  /** Where the config came from: `env`, or the path of `app.json`. Never the key. */
  source: string
}

export type AppAuthEnv = Record<string, string | undefined>

/** Minimal `fetch` shape, injectable for tests. */
export type FetchJson = (
  url: string,
  init: { method: string; headers: Record<string, string> },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class AppAuthError extends Error {
  readonly status: number | undefined
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'AppAuthError'
    this.status = status
  }
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url')
}

/** Signs a ten-minute App JWT, backdated a minute for clock drift. */
export function createAppJwt(appId: string, privateKey: string, nowSeconds: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64url(
    JSON.stringify({ iat: nowSeconds - 60, exp: nowSeconds + 540, iss: appId }),
  )
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${payload}`)
  return `${header}.${payload}.${base64url(signer.sign(privateKey))}`
}

type CachedToken = { token: string; expiresAt: number }

/** Token for an owner; `repo` locates the installation, otherwise the organization does. */
export type TokenProvider = (owner: string, repo?: string) => Promise<string>

const REFRESH_MARGIN_MS = 5 * 60 * 1000

/** One App-JWT-authenticated GitHub request, shared by installation lookup, tokens, and identity. */
async function callApp(
  config: AppConfig,
  fetchJson: FetchJson,
  now: () => number,
  method: string,
  path: string,
): Promise<Record<string, unknown>> {
  const jwt = createAppJwt(config.appId, config.privateKey, Math.floor(now() / 1000))
  const response = await fetchJson(`${config.apiUrl}${path}`, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${jwt}`,
      'x-github-api-version': '2022-11-28',
    },
  })
  if (!response.ok) {
    throw new AppAuthError(
      `GitHub App request ${method} ${path} failed with ${response.status}.`,
      response.status,
    )
  }
  return (await response.json()) as Record<string, unknown>
}

/**
 * The App's own review login, `<slug>[bot]`, from `GET /app`. A successful lookup is cached for
 * the process; a failure is not, so a transient error does not stick.
 */
export function createAppIdentityProvider(
  config: AppConfig,
  fetchJson: FetchJson = fetch as unknown as FetchJson,
  now: () => number = Date.now,
): () => Promise<string> {
  let login: string | undefined
  return async () => {
    if (login !== undefined) return login
    const app = await callApp(config, fetchJson, now, 'GET', '/app')
    if (typeof app.slug !== 'string' || app.slug === '') {
      throw new AppAuthError('GitHub App response had no slug.')
    }
    login = `${app.slug}[bot]`
    return login
  }
}

/**
 * Mints installation tokens for an App and caches each until five minutes before it expires.
 * The installation is resolved from the repository unless the config pins one.
 */
export function createInstallationTokenProvider(
  config: AppConfig,
  fetchJson: FetchJson = fetch as unknown as FetchJson,
  now: () => number = Date.now,
): TokenProvider {
  const cache = new Map<string, CachedToken>()
  const installations = new Map<string, string>()
  const call = (method: string, path: string) => callApp(config, fetchJson, now, method, path)
  const installationFor = async (owner: string, repo?: string): Promise<string> => {
    if (config.installationId !== undefined) return config.installationId
    const known = installations.get(owner)
    if (known !== undefined) return known
    const found =
      repo === undefined
        ? await call('GET', `/orgs/${owner}/installation`).catch((error: unknown) => {
            // A personal account has no organization endpoint.
            if (error instanceof AppAuthError && error.status === 404) {
              return call('GET', `/users/${owner}/installation`)
            }
            throw error
          })
        : await call('GET', `/repos/${owner}/${repo}/installation`)
    const id = String(found.id)
    installations.set(owner, id)
    return id
  }
  return async (owner, repo) => {
    const id = await installationFor(owner, repo)
    const cached = cache.get(id)
    if (cached !== undefined && cached.expiresAt - REFRESH_MARGIN_MS > now()) return cached.token
    const minted = await call('POST', `/app/installations/${id}/access_tokens`)
    if (typeof minted.token !== 'string' || typeof minted.expires_at !== 'string') {
      throw new AppAuthError('GitHub App token response had no token.')
    }
    cache.set(id, { token: minted.token, expiresAt: Date.parse(minted.expires_at) })
    return minted.token
  }
}
