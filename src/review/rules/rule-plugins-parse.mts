/** A plugin name: the part of `name@marketplace` before the `@`. */
const PLUGIN_NAME = /^[A-Za-z0-9._-]+$/u

/**
 * The `rulePlugins` list: unique plugin names. A list with any bad entry is ignored whole, so a
 * typo cannot silently shrink the set of rules a review applies.
 */
export function parseRulePlugins(
  raw: unknown,
  where: string,
  problems: string[],
): string[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be an array of plugin names; ignored`)
    return undefined
  }
  if (raw.some((name) => typeof name !== 'string' || !PLUGIN_NAME.test(name))) {
    problems.push(
      `${where}: each entry must be a plugin name (letters, digits, ".", "_", "-"; no "@marketplace"); ignored`,
    )
    return undefined
  }
  const names = raw as string[]
  const repeated = names.find((name, index) => names.indexOf(name) !== index)
  if (repeated !== undefined) {
    problems.push(`${where}: "${repeated}" is listed more than once; ignored`)
    return undefined
  }
  return names
}
