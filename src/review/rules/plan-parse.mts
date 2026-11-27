import type { AuthorReview, AuthorRule } from '../author-rules.mts'
import { isRecord, unknownKeys } from './settings-parse.mts'

/** The `plan` key as a config file sets it; every part may be absent. */
export type PlanConfig = {
  /** Globs of repository paths that also trigger the security pillar. */
  securityPaths?: string[]
  /** Globs of repository paths that count as generated, like lockfiles and build output. */
  generatedPaths?: string[]
  /** Per-author review rules; see `AuthorRule`. */
  authors?: AuthorRule[]
  /** A first review of at most this many reviewable lines, with no security trigger, is light. */
  smallChangeLines?: number
  /** Globs of repository paths that count as SQL: a small change to one is reviewed in full. */
  sqlPaths?: string[]
  /** A follow-up whose new commits change more than this many lines of source is reviewed in full. */
  followUpSourceLines?: number
}

export type PlanFileScope = 'repo' | 'owner' | 'target' | 'trusted'

type PlanKey =
  | 'securityPaths'
  | 'generatedPaths'
  | 'authors'
  | 'smallChangeLines'
  | 'sqlPaths'
  | 'followUpSourceLines'

const KEYS: readonly PlanKey[] = [
  'securityPaths',
  'generatedPaths',
  'authors',
  'smallChangeLines',
  'sqlPaths',
  'followUpSourceLines',
]

const REVIEWS: readonly AuthorReview[] = ['light', 'skip']

function parseAuthors(raw: unknown, where: string, problems: string[]): AuthorRule[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be a list of { login, review } rules; ignored`)
    return undefined
  }
  const rules: AuthorRule[] = []
  for (const [index, entry] of raw.entries()) {
    const at = `${where}[${index}]`
    const login = isRecord(entry) && typeof entry.login === 'string' ? entry.login.trim() : ''
    const review = REVIEWS.find((name) => isRecord(entry) && entry.review === name)
    if (login === '' || review === undefined) {
      problems.push(
        `${at}: must be { login, review } with a login and review "light" or "skip"; ignored`,
      )
      return undefined
    }
    problems.push(...unknownKeys(entry as Record<string, unknown>, ['login', 'review'], at))
    rules.push({ login, review })
  }
  return rules
}

function parseStrings(raw: unknown, where: string, noun: string, problems: string[]) {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be a list of ${noun}; ignored`)
    return undefined
  }
  const bad = raw.findIndex((entry) => typeof entry !== 'string' || entry.trim() === '')
  if (bad !== -1) {
    problems.push(`${where}: entry ${bad} must be a non-empty string; ignored`)
    return undefined
  }
  return (raw as string[]).map((entry) => entry.trim())
}

/** Why this file may not set `key`, or undefined when it may. */
function refusal(fileScope: PlanFileScope, key: PlanKey): string | undefined {
  if (key === 'authors') {
    return fileScope === 'target' || fileScope === 'trusted' ? 'machine-only' : undefined
  }
  if (key === 'securityPaths' || key === 'sqlPaths') return undefined
  return fileScope === 'target' ? 'machine-only unless trustRepoConfig is on' : undefined
}

/**
 * The `plan` key: values the dispatcher otherwise fixes. A repository's own file (`target`) may
 * add `securityPaths` and `sqlPaths`, which only makes a review stricter. `generatedPaths`, `smallChangeLines` and `followUpSourceLines`
 * reduce review, so a repository file sets them only when `trusted`; `authors` is machine-only.
 * A value that is refused or invalid is ignored with a problem naming the file and key.
 */
export function parsePlan(
  fileScope: PlanFileScope,
  raw: unknown,
  where: string,
  problems: string[],
): PlanConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  problems.push(...unknownKeys(raw, [...KEYS, 'skipAuthors'], where))
  if (raw.skipAuthors !== undefined) {
    problems.push(
      `${where}.skipAuthors: no longer a setting; use ${where}.authors: [{ login, review: "light" }]; ignored`,
    )
  }
  const value = (key: PlanKey): unknown => {
    const why = refusal(fileScope, key)
    if (why === undefined || raw[key] === undefined) return raw[key]
    problems.push(`${where}.${key}: ${why}; ignored`)
    return undefined
  }
  const securityPaths = parseStrings(
    value('securityPaths'),
    `${where}.securityPaths`,
    'glob patterns',
    problems,
  )
  const generatedPaths = parseStrings(
    value('generatedPaths'),
    `${where}.generatedPaths`,
    'glob patterns',
    problems,
  )
  const authors = parseAuthors(value('authors'), `${where}.authors`, problems)
  const sqlPaths = parseStrings(value('sqlPaths'), `${where}.sqlPaths`, 'glob patterns', problems)
  const count = (key: 'smallChangeLines' | 'followUpSourceLines'): number | undefined => {
    const raw = value(key)
    if (Number.isInteger(raw) && (raw as number) >= 0) return raw as number
    if (raw !== undefined) problems.push(`${where}.${key}: must be a non-negative integer; ignored`)
    return undefined
  }
  const lines = count('smallChangeLines')
  const followUpLines = count('followUpSourceLines')
  return {
    ...(securityPaths === undefined ? {} : { securityPaths }),
    ...(generatedPaths === undefined ? {} : { generatedPaths }),
    ...(authors === undefined ? {} : { authors }),
    ...(sqlPaths === undefined ? {} : { sqlPaths }),
    ...(lines === undefined ? {} : { smallChangeLines: lines }),
    ...(followUpLines === undefined ? {} : { followUpSourceLines: followUpLines }),
  }
}
