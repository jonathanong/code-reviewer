import { AppNotInstalledError, isAppConfigFailure, splitRepo } from '../gh-cli/index.mts'
import type { ReviewDeps } from './deps.mts'

/** The auth mode and trusted identity; with `--owner` or `--repo`, also whether the App covers it. */
export async function authCommand(
  values: { owner?: string | undefined; repo?: string[] | undefined },
  deps: ReviewDeps,
): Promise<unknown> {
  const identity = { mode: deps.authMode(), ...(await deps.authIdentity()) }
  const [repo] = values.repo ?? []
  const { owner, name } =
    repo === undefined ? { owner: values.owner, name: undefined } : splitRepo(repo)
  if (owner === undefined) return identity
  try {
    await deps.checkInstallation(owner, name)
    return identity
  } catch (error: unknown) {
    if (!(error instanceof AppNotInstalledError)) throw error
    return { ...identity, installationError: error.message }
  }
}

type Scope = { owner?: string | undefined; repo?: string[] | undefined }

/**
 * With the App configured, fails before any other work when it cannot act for the repositories or
 * owner in scope (and, when `identity`, cannot look up its own login): a configuration error, never
 * a fallback to the `gh` login. A transient GitHub failure is rethrown as it is. A no-op under the
 * `gh` login.
 */
export async function requireApp(
  values: Scope,
  deps: ReviewDeps,
  identity: boolean,
): Promise<void> {
  if (deps.authMode() !== 'app') return
  const scopes = new Map<string, [string, string | undefined]>()
  for (const repo of values.repo ?? []) {
    const { owner, name } = splitRepo(repo)
    scopes.set(`${owner}/${name}`, [owner, name])
  }
  if (values.owner !== undefined) scopes.set(values.owner, [values.owner, undefined])
  for (const [owner, name] of scopes.values()) {
    try {
      await deps.checkInstallation(owner, name)
    } catch (error: unknown) {
      if (error instanceof AppNotInstalledError) throw error
      if (isAppConfigFailure(error)) {
        throw new Error(
          `The GitHub App is configured but cannot act for ${name === undefined ? owner : `${owner}/${name}`}, and the gh login is never used as a fallback: ${error.message}`,
          { cause: error },
        )
      }
      throw error
    }
  }
  if (identity && scopes.size > 0) {
    const { loginError } = await deps.authIdentity()
    if (loginError !== undefined) throw new Error(loginError)
  }
}
