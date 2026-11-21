import { splitRepo, type GhAuth } from '../gh-cli/index.mts'

/** The trusted review login, or why it could not be looked up; see `ReviewDeps.authIdentity`. */
export async function authIdentityOf(
  auth: GhAuth,
  owner?: string,
  repo?: string,
): Promise<{ source?: string; login?: string; loginError?: string; appInstalled?: false }> {
  try {
    if (owner !== undefined && (await auth.modeFor(owner, repo)) === 'gh') {
      return auth.mode === 'app' ? { appInstalled: false } : {}
    }
    const login = await auth.identity()
    return {
      ...(auth.source === undefined ? {} : { source: auth.source }),
      ...(login === undefined ? {} : { login }),
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { loginError: `own identity lookup failed, so no review marker is trusted: ${reason}` }
  }
}

/** The App's login only where the App is installed; a `gh` login's identity is its own viewer. */
export function identityForRepo(auth: GhAuth, repo: string): () => Promise<string | undefined> {
  return async () => {
    const { owner, name } = splitRepo(repo)
    return (await auth.modeFor(owner, name)) === 'app' ? auth.identity() : undefined
  }
}
