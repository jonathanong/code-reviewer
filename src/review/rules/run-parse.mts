import { isRecord, unknownKeys } from './settings-parse.mts'

/** The reasons `run` holds a finished review for a human instead of posting it. */
export const HOLD_RULES = [
  'unclear-intent',
  'large-change',
  'risky-change',
  'partial-failure',
  'not-app-identity',
  'text-too-long',
] as const

export type HoldRule = (typeof HOLD_RULES)[number]

/** A change over either limit is large. */
export type LargeChange = { files: number; lines: number }

export type RunSettings = {
  rules: Record<HoldRule, boolean>
  largeChange: LargeChange
  /** Globs that replace the default risky paths; `undefined` keeps the default. */
  riskyPaths?: string[] | undefined
}

/** The line limit is ten times what the dispatcher calls a small pull request. */
export const DEFAULT_RUN: RunSettings = {
  rules: {
    'unclear-intent': true,
    'large-change': true,
    'risky-change': true,
    'partial-failure': true,
    'not-app-identity': true,
    'text-too-long': true,
  },
  largeChange: { files: 50, lines: 1000 },
}

export type RunConfig = {
  rules?: Partial<Record<HoldRule, boolean>>
  largeChange?: Partial<LargeChange>
  riskyPaths?: string[]
}

function isCount(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0
}

function parseRules(raw: unknown, where: string, problems: string[]) {
  const rules: Partial<Record<HoldRule, boolean>> = {}
  if (raw === undefined) return rules
  if (!isRecord(raw)) {
    problems.push(`${where} rules: must be an object`)
    return rules
  }
  problems.push(...unknownKeys(raw, HOLD_RULES, `${where} rules`))
  for (const rule of HOLD_RULES) {
    const value = raw[rule]
    if (typeof value === 'boolean') rules[rule] = value
    else if (value !== undefined) problems.push(`${where} rules: "${rule}" must be true or false`)
  }
  return rules
}

function parseLarge(raw: unknown, where: string, problems: string[]) {
  const large: Partial<LargeChange> = {}
  if (raw === undefined) return large
  if (!isRecord(raw)) {
    problems.push(`${where} largeChange: must be an object`)
    return large
  }
  problems.push(...unknownKeys(raw, ['files', 'lines'], `${where} largeChange`))
  for (const key of ['files', 'lines'] as const) {
    const value = raw[key]
    if (isCount(value)) large[key] = value
    else if (value !== undefined) {
      problems.push(`${where} largeChange: "${key}" must be a positive integer`)
    }
  }
  return large
}

function parseRisky(raw: unknown, where: string, problems: string[]): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${where} riskyPaths: must be a list of glob patterns`)
    return undefined
  }
  const globs: string[] = []
  raw.forEach((entry: unknown, index) => {
    if (typeof entry === 'string' && entry.trim() !== '') globs.push(entry)
    else problems.push(`${where} riskyPaths: entry ${index} must be a non-empty string`)
  })
  return globs
}

/** Parses the `run` key. Every problem is reported; `run` refuses to start while any stands. */
export function parseRun(raw: unknown, where: string, problems: string[]): RunConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object`)
    return undefined
  }
  problems.push(...unknownKeys(raw, ['rules', 'largeChange', 'riskyPaths'], where))
  const riskyPaths = parseRisky(raw.riskyPaths, where, problems)
  return {
    ...(riskyPaths === undefined ? {} : { riskyPaths }),
    rules: parseRules(raw.rules, where, problems),
    largeChange: parseLarge(raw.largeChange, where, problems),
  }
}
