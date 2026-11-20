import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  createGhReviewIo,
  createGhLabelIo,
  createGhPrepareIo,
  parseTrustedAuthors,
  repoSettings,
  type ReviewIo,
  type LabelIo,
  type PrepareIo,
  type PullTarget,
} from '../review/index.mts'
import type { Exec } from '../review/benchmark/exec.mts'
import { pluginRoot } from '../plugin-root.mts'
import {
  parsePluginInstalls,
  parsePluginList,
  type Plugin,
  type PluginInfo,
} from '../review/plugins.mts'
import { loadRepoConfigs, machineConfigDir, type RepoConfigs } from '../review/rules/config.mts'
import {
  apiFileReader,
  readTargetConfig,
  type TargetConfig,
} from '../review/rules/target-config.mts'
import {
  createGhAuth,
  runGit,
  splitRepo,
  type GhAuth,
  type RunTextCommand,
} from '../gh-cli/index.mts'

export type ReviewDeps = {
  authMode(): GhAuth['mode']
  /** The per-owner and per-repository settings read from the machine config directory. */
  configs(): RepoConfigs
  /**
   * The `.code-reviewer.json` on `repo`'s default branch, read through the GitHub API at most once
   * per repository; a missing file is no config and a failed read is a problem, not an error.
   */
  targetConfig(repo: string): Promise<TargetConfig>
  createIo(target: PullTarget): ReviewIo
  createLabelIo(target: PullTarget): LabelIo
  createPrepareIo(target: PullTarget): PrepareIo
  /** A `gh` runner for an owner's repositories (queue search, thread resolution). */
  runner(owner: string, repo?: string): RunTextCommand
  readFile(path: string): string
  /** The Claude Code plugins enabled for this session's user and project. */
  listPlugins(): Promise<Plugin[]>
  /** The enabled plugins and where the user-scope ones are installed. */
  pluginInfo(): Promise<PluginInfo>
  /** Runs a binary (`claude`) and resolves its stdout. */
  exec: Exec
  /** The directory holding the verifier and pillar prompts (`skills/review/references`). */
  references(): string
  runBench(args: string[]): Promise<number>
  runVerifierBench(args: string[]): Promise<number>
  runSelectionBench(args: string[]): Promise<number>
}

/** Default dependencies; App or `gh` auth is chosen once, on first use. */
export function createDefaultDeps(
  getAuth: () => GhAuth = createGhAuth,
  env: Record<string, string | undefined> = process.env,
): ReviewDeps {
  const trusted = parseTrustedAuthors(env.CODE_REVIEWER_TRUSTED_AUTHORS)
  let auth: GhAuth | undefined
  let loaded: RepoConfigs | undefined
  const configDir = machineConfigDir(env)
  const configs = () => (loaded ??= loadRepoConfigs(configDir))
  const targets = new Map<string, Promise<TargetConfig>>()
  const targetConfig = (repo: string) => {
    const key = repo.toLowerCase()
    const cached = targets.get(key)
    if (cached !== undefined) return cached
    const read = readTargetConfig(async () => {
      const { owner, name } = splitRepo(repo)
      return apiFileReader(resolved().runner(owner, name), repo)()
    }, repo)
    targets.set(key, read)
    return read
  }
  const resolved = () => (auth ??= getAuth())
  const forTarget = (target: PullTarget) => {
    const { owner, name } = splitRepo(target.repo)
    return resolved().runner(owner, name)
  }
  return {
    authMode: () => resolved().mode,
    configs,
    targetConfig,
    createIo: (target) =>
      createGhReviewIo(
        target,
        forTarget(target),
        trusted,
        async () => (await repoSettings({ configs, targetConfig }, target.repo)).labels.approval,
      ),
    createLabelIo: (target) => createGhLabelIo(target, forTarget(target)),
    createPrepareIo: (target) =>
      createGhPrepareIo(
        target,
        forTarget(target),
        runGit,
        trusted,
        env.CODE_REVIEWER_CLONE_ROOT,
        configDir,
      ),
    runner: (owner, repo) => resolved().runner(owner, repo),
    readFile: (path) => readFileSync(path, 'utf8'),
    listPlugins: async () => {
      const { defaultExec } = await import('../review/benchmark/exec.mts')
      return parsePluginList(
        await defaultExec('claude', ['plugin', 'list', '--json']),
        process.cwd(),
      )
    },
    pluginInfo: async () => {
      const { defaultExec } = await import('../review/benchmark/exec.mts')
      const listed = await defaultExec('claude', ['plugin', 'list', '--json'])
      return {
        enabled: parsePluginList(listed, process.cwd()),
        installs: parsePluginInstalls(listed),
      }
    },
    exec: async (command, args, options) =>
      (await import('../review/benchmark/exec.mts')).defaultExec(command, args, options),
    references: () => join(pluginRoot(), 'skills/review/references'),
    runBench: async (args) => (await import('../review/benchmark/cli.mts')).runReviewBenchCli(args),
    runVerifierBench: async (args) =>
      (await import('../review/benchmark/verifier-cli.mts')).runReviewVerifierBenchCli(args),
    runSelectionBench: async (args) =>
      (await import('../review/benchmark/selection-cli.mts')).runReviewSelectionBenchCli(args),
  }
}
