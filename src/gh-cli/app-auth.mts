import { createSign } from 'node:crypto'

/** GitHub App credentials; without them every call uses the local `gh` login. */
export type AppConfig = {
  appId: string
  privateKey: string
  /** Fixed installation; otherwise it is looked up per repository owner. */
  installationId?: string
  apiUrl: string
  /** Where the config came from: `env`, or the path of the App config file. Never the key. */
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
  constructor(message: string, status?: number, options?: ErrorOptions) {
    super(message, options)
    this.name = 'AppAuthError'
    this.status = status
  }
}

/**
 * The App is configured but not installed for `owner` (or does not cover `repo`). A machine uses
 * the App or the `gh` login, never a mix, so this is an error and not a fallback.
 */
export class AppNotInstalledError extends AppAuthError {
  readonly owner: string
  readonly repo: string | undefined
  constructor(owner: string, repo: string | undefined, cause: unknown) {
    const where = repo === undefined ? owner : `${owner}/${repo}`
    super(
      `The GitHub App is configured but not installed for ${where}. Install it for ${
        repo === undefined ? 'that owner' : 'that repository'
      }, or review ${where} from a machine with no App configured; the gh login is never used as a fallback.`,
      404,
    )
    this.name = 'AppNotInstalledError'
    this.owner = owner
    this.repo = repo
    this.cause = cause
  }
}

/**
 * Whether an App failure is a configuration problem (bad key, token refused, not installed): any
 * `AppAuthError` except a GitHub 5xx. A 5xx or a network error is transient, not configuration.
 */
export function isAppConfigFailure(error: unknown): error is AppAuthError {
  return error instanceof AppAuthError && (error.status === undefined || error.status < 500)
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
  let jwt: string
  try {
    jwt = createAppJwt(config.appId, config.privateKey, Math.floor(now() / 1000))
  } catch (error) {
    throw new AppAuthError(
      `GitHub App private key (${config.source}) could not sign a request: ${(error as Error).message}`,
      undefined,
      { cause: error },
    )
  }
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
    const key = repo === undefined ? owner : `${owner}/${repo}`
    const known = installations.get(key)
    if (known !== undefined) return known
    const lookup = async (path: string) => {
      try {
        return await call('GET', path)
      } catch (error) {
        if (error instanceof AppAuthError && error.status === 404) {
          throw new AppNotInstalledError(owner, repo, error)
        }
        throw error
      }
    }
    const found =
      repo === undefined
        ? await call('GET', `/orgs/${owner}/installation`).catch((error: unknown) => {
            // A personal account has no organization endpoint.
            if (error instanceof AppAuthError && error.status === 404) {
              return lookup(`/users/${owner}/installation`)
            }
            throw error
          })
        : await lookup(`/repos/${owner}/${repo}/installation`)
    const id = String(found.id)
    installations.set(key, id)
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
