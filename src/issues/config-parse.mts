import { isRecord, REPO_RE, unknownKeys } from '../review/rules/settings-parse.mts'

/** The most issues filed in any 24 hours, across all targets, when `issues.maxPerDay` is absent. */
export const DEFAULT_MAX_ISSUES_PER_DAY = 3

/** The name a proposal about the reviewer itself carries. */
export const REVIEWER_TARGET = 'code-reviewer'

/** The name a proposal about a harness (the CLI a step ran through) carries. */
export const HARNESS_TARGET = 'harness'

export type IssueTarget = {
  /** A rule plugin name, `code-reviewer`, or `harness`. */
  name: string
  /** `owner/name` where the issues go. */
  repo: string
  labels: string[]
}

/** The `issues` key. Absent means nothing is ever filed. */
export type IssuesConfig = { maxPerDay: number; targets: IssueTarget[] }

const hasControl = (value: string) => /\p{Cc}/u.test(value)
const isText = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && !hasControl(value)

function parseTarget(raw: unknown, where: string, found: string[]): IssueTarget | undefined {
  if (!isRecord(raw)) {
    found.push(`${where}: must be an object`)
    return undefined
  }
  const before = found.length
  found.push(...unknownKeys(raw, ['name', 'repo', 'labels'], where))
  if (!isText(raw.name)) found.push(`${where}.name: must be a non-empty string`)
  if (typeof raw.repo !== 'string' || !REPO_RE.test(raw.repo)) {
    found.push(`${where}.repo: must be owner/name`)
  }
  const labels = raw.labels ?? []
  if (!Array.isArray(labels) || !labels.every(isText)) {
    found.push(`${where}.labels: must be a list of non-empty strings`)
  }
  if (found.length > before) return undefined
  return {
    name: (raw.name as string).trim(),
    repo: raw.repo as string,
    labels: (labels as string[]).map((label) => label.trim()),
  }
}

/** The `issues` key. A key with any problem is ignored whole, so a typo cannot widen where issues go. */
export function parseIssues(
  raw: unknown,
  where: string,
  problems: string[],
): IssuesConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  const found = unknownKeys(raw, ['maxPerDay', 'targets'], where)
  const max = raw.maxPerDay ?? DEFAULT_MAX_ISSUES_PER_DAY
  if (typeof max !== 'number' || !Number.isInteger(max) || max < 1) {
    found.push(`${where}.maxPerDay: must be an integer of at least 1`)
  }
  const list = raw.targets
  const targets: IssueTarget[] = []
  if (!Array.isArray(list)) {
    found.push(`${where}.targets: must be a list`)
  } else {
    list.forEach((item, index) => {
      const target = parseTarget(item, `${where}.targets[${index}]`, found)
      if (target !== undefined) targets.push(target)
    })
    const names = targets.map((target) => target.name)
    for (const name of new Set(names.filter((name, index) => names.indexOf(name) !== index))) {
      found.push(`${where}.targets: name "${name}" is listed more than once`)
    }
  }
  if (found.length > 0) {
    problems.push(...found.map((problem) => `${problem}; issues ignored`))
    return undefined
  }
  return { maxPerDay: max as number, targets }
}
