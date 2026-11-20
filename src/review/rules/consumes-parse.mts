import type { Consumes } from './config.mts'
import { REPO_RE, isRecord, unknownKeys } from './settings-parse.mts'

const CONSUMES_KEYS = ['repo', 'paths', 'via']

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

export function consumesList(raw: unknown, file: string, problems: string[]): Consumes[] {
  const list = raw ?? []
  if (!Array.isArray(list)) {
    problems.push(`${file}: "consumes" must be an array`)
    return []
  }
  return list
    .map((item, index) => consumes(item, `${file} consumes[${index}]`, problems))
    .filter((item) => item !== undefined)
}
