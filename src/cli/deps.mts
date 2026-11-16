import { readFileSync } from 'node:fs'

import {
  createGhFinalReviewIo,
  createGhLabelIo,
  createGhPrepareIo,
  parseTrustedAuthors,
  reviewSettings,
  type FinalReviewIo,
  type LabelIo,
  type PrepareIo,
  type PullTarget,
} from '../final-review/index.mts'
import { parsePluginList, type Plugin } from '../final-review/plugins.mts'
import {
  DEFAULT_CONFIG_DIR,
  loadRepoConfigs,
  type RepoConfigs,
} from '../final-review/rules/config.mts'
import {
  createGhAuth,
  runGit,
  splitRepo,
  type GhAuth,
  type RunTextCommand,
} from '../gh-cli/index.mts'

export type FinalReviewDeps = {
  authMode(): GhAuth['mode']
  /** The per-owner and per-repository settings read from this repository's `repos/` directory. */
  configs(): RepoConfigs
  createIo(target: PullTarget): FinalReviewIo
  createLabelIo(target: PullTarget): LabelIo
  createPrepareIo(target: PullTarget): PrepareIo
  /** A `gh` runner for an owner's repositories (queue search, thread resolution). */
  runner(owner: string, repo?: string): RunTextCommand
  readFile(path: string): string
  /** The Claude Code plugins enabled for this session's user and project. */
  listPlugins(): Promise<Plugin[]>
  runBench(args: string[]): Promise<number>
  runVerifierBench(args: string[]): Promise<number>
}

/** Default dependencies; App or `gh` auth is chosen once, on first use. */
export function createDefaultDeps(
  getAuth: () => GhAuth = createGhAuth,
  env: Record<string, string | undefined> = process.env,
): FinalReviewDeps {
  const trusted = parseTrustedAuthors(env.FINAL_REVIEWER_TRUSTED_AUTHORS)
  let auth: GhAuth | undefined
  let loaded: RepoConfigs | undefined
  const configs = () =>
    (loaded ??= loadRepoConfigs(env.FINAL_REVIEWER_CONFIG_DIR ?? DEFAULT_CONFIG_DIR))
  const resolved = () => (auth ??= getAuth())
  const forTarget = (target: PullTarget) => {
    const { owner, name } = splitRepo(target.repo)
    return resolved().runner(owner, name)
  }
  return {
    authMode: () => resolved().mode,
    configs,
    createIo: (target) =>
      createGhFinalReviewIo(
        target,
        forTarget(target),
        trusted,
        reviewSettings(configs(), target.repo).labels.approval,
      ),
    createLabelIo: (target) => createGhLabelIo(target, forTarget(target)),
    createPrepareIo: (target) =>
      createGhPrepareIo(target, forTarget(target), runGit, trusted, env.FINAL_REVIEWER_CLONE_ROOT),
    runner: (owner, repo) => resolved().runner(owner, repo),
    readFile: (path) => readFileSync(path, 'utf8'),
    listPlugins: async () => {
      const { defaultExec } = await import('../final-review/benchmark/exec.mts')
      return parsePluginList(
        await defaultExec('claude', ['plugin', 'list', '--json']),
        process.cwd(),
      )
    },
    runBench: async (args) =>
      (await import('../final-review/benchmark/cli.mts')).runFinalReviewBenchCli(args),
    runVerifierBench: async (args) =>
      (await import('../final-review/benchmark/verifier-cli.mts')).runFinalReviewVerifierBenchCli(
        args,
      ),
  }
}
