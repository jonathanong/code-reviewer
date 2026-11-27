import type { Exec } from '../review/benchmark/exec.mts'
import type { AppConfig } from '../gh-cli/index.mts'
import type { RepoConfigs } from '../review/rules/config.mts'

export type Status = 'ok' | 'warn' | 'fail'

/** One finding: a line for a person, and on warn or fail the exact command or edit that fixes it. */
export type Check = { name: string; status: Status; detail: string; fix?: string }

export type DoctorResult = {
  ok: number
  warn: number
  fail: number
  checks: Check[]
}

/** The file system reads a check needs; none of them writes. */
export type DoctorFs = {
  /** The modification time of a file or directory; undefined when it does not exist. */
  mtimeMs(path: string): number | undefined
  /** The entries of a directory; undefined when it does not exist. */
  list(path: string): string[] | undefined
  /** The text of a file; undefined when it does not exist. */
  readText(path: string): string | undefined
  isDirectory(path: string): boolean
  /** Whether the current user may write to the path, asked of the file system without writing. */
  writable(path: string): boolean
}

/** Everything `doctor` touches, injected so tests run with none of it real. */
export type DoctorIo = {
  env: Record<string, string | undefined>
  now(): Date
  /** `process.versions.node`. */
  nodeVersion: string
  /** The `engines.node` range of this package. */
  nodeRange: string
  exec: Exec
  fs: DoctorFs
  /** The App config, undefined when none is configured; throws when one is wrong. */
  loadApp(): AppConfig | undefined
  /** The machine config; throws when the directory cannot be read. */
  configs(): RepoConfigs
  /** Rejects with `AppNotInstalledError` when the App is configured but not installed for the scope. */
  checkInstallation(owner: string, repo?: string): Promise<void>
  configDir: string
  stateDir: string
  tmpDir: string
  /** The Claude Code home, where `plugins/known_marketplaces.json` lives. */
  claudeHome: string
  /** The clone of `repo` under `root`, if any. */
  findClone(root: string, repo: string): Promise<string | undefined>
}

export type DoctorFlags = {
  repo?: string
  owner?: string
  /** The directory of clones to check; else `CODE_REVIEWER_CLONE_ROOT`. */
  clones?: string
  offline: boolean
}

export type Context = { io: DoctorIo; flags: DoctorFlags }
