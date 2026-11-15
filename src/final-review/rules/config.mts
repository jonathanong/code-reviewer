import type { RuleReader } from './reader.mts'

/** The per-repository file, at the repository root, that holds what the reviewer must know. */
export const CONFIG_FILE = '.code-reviewer.json'

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

/** Parses the config file's text; a missing file is an empty config, and errors become problems. */
export function parseRepoConfig(text: string | undefined): RepoConfig {
  if (text === undefined) return { consumes: [], problems: [] }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { consumes: [], problems: [`${CONFIG_FILE}: not valid JSON; ignored`] }
  }
  if (!isRecord(raw)) {
    return { consumes: [], problems: [`${CONFIG_FILE}: must be a JSON object; ignored`] }
  }
  const problems = unknownKeys(raw, KEYS, CONFIG_FILE)
  const list = raw.consumes ?? []
  if (!Array.isArray(list)) {
    return { consumes: [], problems: [...problems, `${CONFIG_FILE}: "consumes" must be an array`] }
  }
  const entries = list
    .map((item, index) => consumes(item, `${CONFIG_FILE} consumes[${index}]`, problems))
    .filter((item) => item !== undefined)
  return { consumes: entries, problems }
}

/** Reads and parses the config file from a rule source. */
export async function readRepoConfig(reader: RuleReader): Promise<RepoConfig> {
  return parseRepoConfig(await reader.read(CONFIG_FILE).catch(() => undefined))
}
