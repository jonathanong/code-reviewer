import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { consumesList } from './consumes-parse.mts'
import { parseEvidence, type EvidenceSource } from './evidence-parse.mts'
import { parseReferences, type ReferenceSource } from './references-parse.mts'
import { parseRulePlugins } from './rule-plugins-parse.mts'
import { parseRun, type RunConfig } from './run-parse.mts'
import {
  parseCheckRun,
  parseLabels,
  parseSwitch,
  type CheckRunSettings,
  type LabelNames,
} from './settings-parse.mts'

/** The reviewer's config home, `code-reviewer` under the XDG config home; `app.json` lives here. */
export function configHome(env: Record<string, string | undefined>): string {
  return join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config'), 'code-reviewer')
}

/**
 * The machine config directory: `CODE_REVIEWER_CONFIG_DIR`, else `repos` in the config home. It
 * holds one `<owner>/<name>.json` per repository, and `<owner>.json` beside that directory for
 * the settings every repository of the owner shares.
 */
export function machineConfigDir(env: Record<string, string | undefined>): string {
  return env.CODE_REVIEWER_CONFIG_DIR || join(configHome(env), 'repos')
}

/** Another repository this one depends on without a package import (an HTTP API, a schema). */
export type Consumes = {
  /** `owner/name`, lowercased. */
  repo: string
  /** Globs in the consumed repository that this one depends on; empty means all of it. */
  paths: string[]
  /** How it is consumed, in a few words; empty when not given. */
  via: string
}

export type RepoConfig = {
  consumes: Consumes[]
  labels?: Partial<LabelNames>
  checkRun?: CheckRunSettings
  /** Machine config only; a reviewed repository's own file never sets it. */
  evidence?: EvidenceSource[]
  /** Machine config only: it grants network access, so a reviewed repository's file never sets it. */
  references?: ReferenceSource[]
  /** Machine config only: `false` switches off the second check on an approval. */
  approvalCheck?: boolean
  /**
   * Machine config only: the plugins whose skills hold the shared rules, replacing the default
   * list. An enabled plugin loads its hooks too, so a reviewed repository's file never sets it.
   */
  rulePlugins?: string[]
  /** Machine config only: it decides what the reviewer posts unattended. */
  run?: RunConfig
  problems: string[]
}

/**
 * A repository file holds every key; an owner file holds only the settings repositories share; the
 * reviewed repository's own file (`target`) holds everything but `evidence`.
 */
type ConfigScope = 'repo' | 'owner' | 'target'

const KEYS = new Set([
  'consumes',
  'labels',
  'checkRun',
  'evidence',
  'references',
  'approvalCheck',
  'rulePlugins',
  'run',
])

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unknownKeys(record: Json, known: ReadonlySet<string>, where: string): string[] {
  return Object.keys(record)
    .filter((key) => !known.has(key))
    .map((key) => `${where}: unknown key "${key}" ignored`)
}

/** Parses one config file's text; errors become problems that name `file`. */
export function parseRepoConfig(
  text: string,
  file: string,
  scope: ConfigScope = 'repo',
): RepoConfig {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { consumes: [], problems: [`${file}: not valid JSON; ignored`] }
  }
  if (!isRecord(raw)) {
    return { consumes: [], problems: [`${file}: must be a JSON object; ignored`] }
  }
  const problems = unknownKeys(raw, KEYS, file)
  const labels = parseLabels(raw.labels, `${file} labels`, problems)
  const checkRun = parseCheckRun(raw.checkRun, `${file} checkRun`, problems)
  if (scope === 'owner' && raw.consumes !== undefined) {
    problems.push(`${file}: "consumes" is repo-level only; ignored`)
  }
  // Evidence sources grant shell commands on this machine, so only machine files may set them.
  if (scope === 'target' && raw.evidence !== undefined) {
    problems.push(`${file}: evidence sources are machine-only; ignored`)
  }
  const evidence =
    scope === 'target' ? undefined : parseEvidence(raw.evidence, `${file} evidence`, problems)
  // References grant network access while the run holds private code, so only machine files set them.
  if (scope === 'target' && raw.references !== undefined) {
    problems.push(`${file}: references are machine-only; ignored`)
  }
  const references =
    scope === 'target' ? undefined : parseReferences(raw.references, `${file} references`, problems)
  // A repository that could switch off the check on its own approvals would weaken its own review.
  if (scope === 'target' && raw.approvalCheck !== undefined) {
    problems.push(`${file}: approvalCheck is machine-only; ignored`)
  }
  const approvalCheck =
    scope === 'target'
      ? undefined
      : parseSwitch(raw.approvalCheck, `${file} approvalCheck`, problems)
  if (scope === 'target' && raw.rulePlugins !== undefined) {
    problems.push(`${file}: rulePlugins is machine-only; ignored`)
  }
  const rulePlugins =
    scope === 'target'
      ? undefined
      : parseRulePlugins(raw.rulePlugins, `${file} rulePlugins`, problems)
  if (scope === 'target' && raw.run !== undefined) {
    problems.push(`${file}: run settings are machine-only; ignored`)
  }
  const run = scope === 'target' ? undefined : parseRun(raw.run, `${file} run`, problems)
  return {
    consumes: scope === 'owner' ? [] : consumesList(raw.consumes, file, problems),
    ...(labels === undefined ? {} : { labels }),
    ...(checkRun === undefined ? {} : { checkRun }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(references === undefined ? {} : { references }),
    ...(approvalCheck === undefined ? {} : { approvalCheck }),
    ...(rulePlugins === undefined ? {} : { rulePlugins }),
    ...(run === undefined ? {} : { run }),
    problems,
  }
}

export type RepoConfigs = {
  /** Lowercased `owner/name` to that repository's config. */
  byRepo: ReadonlyMap<string, RepoConfig>
  /** Lowercased owner to the shared settings in `<owner>.json`. */
  byOwner: ReadonlyMap<string, RepoConfig>
  problems: string[]
}

export const NO_CONFIGS: RepoConfigs = { byRepo: new Map(), byOwner: new Map(), problems: [] }

/** Reads every `<owner>.json` and `<owner>/<name>.json` under `dir`; a missing directory has none. */
export function loadRepoConfigs(dir: string): RepoConfigs {
  const byRepo = new Map<string, RepoConfig>()
  const byOwner = new Map<string, RepoConfig>()
  const problems: string[] = []
  if (!existsSync(dir)) return { byRepo, byOwner, problems }
  const entries = readdirSync(dir, { withFileTypes: true })
  const read = (file: string, scope: ConfigScope) => {
    const config = parseRepoConfig(readFileSync(join(dir, file), 'utf8'), file, scope)
    problems.push(...config.problems)
    return config
  }
  const names = (kind: 'isFile' | 'isDirectory') =>
    entries
      .filter((entry) => entry[kind]())
      .map((entry) => entry.name)
      .sort()
  for (const name of names('isFile').filter((file) => file.endsWith('.json'))) {
    byOwner.set(name.slice(0, -'.json'.length).toLowerCase(), read(name, 'owner'))
  }
  for (const owner of names('isDirectory')) {
    for (const name of readdirSync(join(dir, owner))
      .filter((n) => n.endsWith('.json'))
      .sort()) {
      const file = `${owner}/${name}`
      byRepo.set(file.slice(0, -'.json'.length).toLowerCase(), read(file, 'repo'))
    }
  }
  return { byRepo, byOwner, problems }
}
