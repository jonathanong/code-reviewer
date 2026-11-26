/** The five labels the review lifecycle uses on a pull request. */
export type LabelNames = {
  requested: string
  processing: string
  completed: string
  /** A review finished and waiting for a person to post it. */
  held: string
  approval: string
}

export type CheckRunSettings = { name: string }

const LABEL_KEYS = ['requested', 'processing', 'completed', 'held', 'approval'] as const

export type Json = Record<string, unknown>

export function isRecord(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** An `owner/name` repository id. */
export const REPO_RE = /^[A-Za-z0-9-]+\/(?!\.+$)[\w.-]+$/u

/** A label or check name: non-blank, and free of quotes (the queue search quotes it) and controls. */
function isName(value: unknown): value is string {
  return typeof value === 'string' && /^[^"\p{Cc}]+$/u.test(value) && value.trim().length > 0
}

export function unknownKeys(record: Json, known: readonly string[], where: string): string[] {
  return Object.keys(record)
    .filter((key) => !known.includes(key))
    .map((key) => `${where}: unknown key "${key}" ignored`)
}

const NAME_RULE = 'must be a non-empty string without quotes or control characters; ignored'

export function parseLabels(
  raw: unknown,
  where: string,
  problems: string[],
): Partial<LabelNames> | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  problems.push(...unknownKeys(raw, LABEL_KEYS, where))
  const labels: Partial<LabelNames> = {}
  for (const key of LABEL_KEYS) {
    const value = raw[key]
    if (value === undefined) continue
    if (isName(value)) labels[key] = value.trim()
    else problems.push(`${where}: "${key}" ${NAME_RULE}`)
  }
  return Object.keys(labels).length > 0 ? labels : undefined
}

export function parseCheckRun(
  raw: unknown,
  where: string,
  problems: string[],
): CheckRunSettings | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  problems.push(...unknownKeys(raw, ['name'], where))
  if (!isName(raw.name)) {
    problems.push(`${where}: "name" ${NAME_RULE}`)
    return undefined
  }
  return { name: raw.name.trim() }
}

/** A `true` or `false` setting; anything else is a problem and the setting is ignored. */
export function parseSwitch(raw: unknown, where: string, problems: string[]): boolean | undefined {
  if (raw === undefined) return undefined
  if (typeof raw === 'boolean') return raw
  problems.push(`${where}: must be true or false; ignored`)
  return undefined
}
