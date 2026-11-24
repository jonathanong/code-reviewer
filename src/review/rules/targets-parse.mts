import { isRecord, unknownKeys } from './settings-parse.mts'

/** The `targets` key as a config file sets it; absent means every built-in target is enabled. */
export type TargetsConfig = {
  disabled?: string[] | 'all'
}

function parseDisabled(
  raw: unknown,
  where: string,
  known: readonly string[],
  problems: string[],
): string[] | 'all' {
  if (raw === 'all') return 'all'
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be "all" or an array of built-in target names`)
    return []
  }
  const names: string[] = []
  for (const entry of raw) {
    const name = known.find((target) => target === entry)
    if (name === undefined) {
      const choices = known.length === 0 ? '"all"' : `${known.join(', ')}, or "all"`
      problems.push(`${where}: unknown target ${JSON.stringify(entry)}; use ${choices}`)
    } else if (names.includes(name)) {
      problems.push(`${where}: "${name}" is listed more than once`)
    } else {
      names.push(name)
    }
  }
  return names
}

/**
 * The `targets` key: built-in targeted checks to switch off, or `"all"`. A key with any problem
 * is ignored whole and stops the command before any work, naming the file and key.
 */
export function parseTargets(
  raw: unknown,
  where: string,
  problems: string[],
  known: readonly string[],
): TargetsConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  const found = unknownKeys(raw, ['disabled'], where)
  const disabled =
    raw.disabled === undefined
      ? undefined
      : parseDisabled(raw.disabled, `${where}.disabled`, known, found)
  if (found.length > 0) {
    problems.push(
      ...found.map((problem) =>
        problem.endsWith('ignored') ? problem : `${problem}; ${where} ignored`,
      ),
    )
    return undefined
  }
  return disabled === undefined ? {} : { disabled }
}
