import {
  createInstallationTokenProvider,
  loadAppConfig,
  type AppAuthEnv,
  type TokenProvider,
} from './app-auth.mts'
import { ghSpawnEnv } from './env.mts'
import { createCommandRunner, runGh, type ExecFileText, type RunTextCommand } from './exec.mts'

/** How `gh` calls authenticate: as the GitHub App, or with the local `gh` login. */
export type GhAuth = {
  mode: 'app' | 'gh'
  /** A `gh` runner for repositories of `owner` (and `repo`, when known). */
  runner(owner: string, repo?: string): RunTextCommand
}

/** Runs `gh` with an App installation token in `GH_TOKEN` (which `gh` prefers over its login). */
export function appRunner(
  tokens: TokenProvider,
  owner: string,
  repo?: string,
  exec?: ExecFileText,
): RunTextCommand {
  return async (args) => {
    const token = await tokens(owner, repo)
    const run = createCommandRunner('gh', exec, (env) => ({ ...ghSpawnEnv(env), GH_TOKEN: token }))
    return run(args)
  }
}

/** Picks App auth when `CODE_REVIEWER_APP_ID` is configured, otherwise the local `gh` login. */
export function createGhAuth(
  env: AppAuthEnv = process.env,
  tokensFor: typeof createInstallationTokenProvider = createInstallationTokenProvider,
): GhAuth {
  const config = loadAppConfig(env)
  if (config === undefined) return { mode: 'gh', runner: () => runGh }
  const tokens = tokensFor(config)
  return { mode: 'app', runner: (owner, repo) => appRunner(tokens, owner, repo) }
}

/** Splits `owner/name` for token lookup. */
export function splitRepo(repo: string): { owner: string; name: string } {
  const [owner = '', name = ''] = repo.split('/')
  return { owner, name }
}
