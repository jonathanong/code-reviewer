import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import { parseEvidence, type EvidenceSource } from './evidence-parse.mts'
import {
  REPO_RE,
  parseCheckRun,
  parseLabels,
  type CheckRunSettings,
  type LabelNames,
} from './settings-parse.mts'

/**
 * The machine config directory: `CODE_REVIEWER_CONFIG_DIR`, else `code-reviewer/repos` under the
 * XDG config home. It holds one `<owner>/<name>.json` per repository, and `<owner>.json` beside
 * that directory for the settings every repository of the owner shares.
 */
export function machineConfigDir(env: Record<string, string | undefined>): string {
  if (env.CODE_REVIEWER_CONFIG_DIR) return env.CODE_REVIEWER_CONFIG_DIR
  const home = env.XDG_CONFIG_HOME || join(env.HOME || homedir(), '.config')
  return join(home, 'code-reviewer', 'repos')
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
  problems: string[]
}

/**
 * A repository file holds every key; an owner file holds only the settings repositories share; the
 * reviewed repository's own file (`target`) holds everything but `evidence`.
 */
type ConfigScope = 'repo' | 'owner' | 'target'

const KEYS = new Set(['consumes', 'labels', 'checkRun', 'evidence'])
const CONSUMES_KEYS = new Set(['repo', 'paths', 'via'])

type Json = Record<string, unknown>

function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function unknownKeys(record: Json, known: ReadonlySet<string>, where: string): string[] {
  return Object.keys(record)
    .filter((key) => !known.has(key))
    .map((key) => `${where}: unknown key "${key}" ignored`)
}

function consumes(raw: unknown, where: string, problems: string[]): Consumes | undefined {
  if (!isRecord(raw) || typeof raw.repo !== 'string' || !REPO_RE.test(raw.repo)) {
    problems.push(`${where}: needs "repo" as owner/name; entry ignored`)
    return undefined
  }
  problems.push(...unknownKeys(raw, CONSUMES_KEYS, where))
  const strings = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === 'string' && item.length > 0)
  if (raw.paths !== undefined && !strings(raw.paths)) {
    problems.push(`${where}: "paths" must be an array of globs; entry ignored`)
    return undefined
  }
  if (raw.via !== undefined && typeof raw.via !== 'string') {
    problems.push(`${where}: "via" must be a string; ignored`)
  }
  return {
    repo: raw.repo.toLowerCase(),
    paths: raw.paths ?? [],
    via: typeof raw.via === 'string' ? raw.via.replace(/\s+/gu, ' ').trim() : '',
  }
}

function consumesList(raw: unknown, file: string, problems: string[]): Consumes[] {
  const list = raw ?? []
  if (!Array.isArray(list)) {
    problems.push(`${file}: "consumes" must be an array`)
    return []
  }
  return list
    .map((item, index) => consumes(item, `${file} consumes[${index}]`, problems))
    .filter((item) => item !== undefined)
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
  return {
    consumes: scope === 'owner' ? [] : consumesList(raw.consumes, file, problems),
    ...(labels === undefined ? {} : { labels }),
    ...(checkRun === undefined ? {} : { checkRun }),
    ...(evidence === undefined ? {} : { evidence }),
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
