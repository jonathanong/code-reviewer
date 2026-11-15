import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Where this repository keeps what the reviewer must know about each reviewed repository, as
 * `<owner>/<name>.json`. Reviewed repositories carry no config of their own.
 */
export const DEFAULT_CONFIG_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../repos')

/** Another repository this one depends on without a package import (an HTTP API, a schema). */
export type Consumes = {
  /** `owner/name`, lowercased. */
  repo: string
  /** Globs in the consumed repository that this one depends on; empty means all of it. */
  paths: string[]
  /** How it is consumed, in a few words; empty when not given. */
  via: string
}

export type RepoConfig = { consumes: Consumes[]; problems: string[] }

const REPO_RE = /^[A-Za-z0-9-]+\/(?!\.+$)[\w.-]+$/u
const KEYS = new Set(['consumes'])
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

/** Parses one config file's text; errors become problems that name `file`. */
export function parseRepoConfig(text: string, file: string): RepoConfig {
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
  const list = raw.consumes ?? []
  if (!Array.isArray(list)) {
    return { consumes: [], problems: [...problems, `${file}: "consumes" must be an array`] }
  }
  const entries = list
    .map((item, index) => consumes(item, `${file} consumes[${index}]`, problems))
    .filter((item) => item !== undefined)
  return { consumes: entries, problems }
}

export type RepoConfigs = {
  /** Lowercased `owner/name` to that repository's config. */
  byRepo: ReadonlyMap<string, RepoConfig>
  problems: string[]
}

export const NO_CONFIGS: RepoConfigs = { byRepo: new Map(), problems: [] }

/** Reads every `<owner>/<name>.json` under `dir`; a missing directory holds no configs. */
export function loadRepoConfigs(dir: string): RepoConfigs {
  const byRepo = new Map<string, RepoConfig>()
  const problems: string[] = []
  if (!existsSync(dir)) return { byRepo, problems }
  const owners = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory())
  for (const owner of owners.map((entry) => entry.name).sort()) {
    const files = readdirSync(join(dir, owner)).filter((name) => name.endsWith('.json'))
    for (const name of files.sort()) {
      const file = `${owner}/${name}`
      const config = parseRepoConfig(readFileSync(join(dir, owner, name), 'utf8'), file)
      byRepo.set(file.slice(0, -'.json'.length).toLowerCase(), config)
      problems.push(...config.problems)
    }
  }
  return { byRepo, problems }
}
