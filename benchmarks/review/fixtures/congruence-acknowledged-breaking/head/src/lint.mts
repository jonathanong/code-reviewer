export type Config = { allow: string[] }

/**
 * Reports a file that imports `legacy-http` unless an allow entry is a prefix of its path.
 * The allow entry that matched is added to `used`. Generated files are never linted.
 */
export function lintFile(
  path: string,
  source: string,
  config: Config,
  used: Set<string>,
): string[] {
  if (path.startsWith('src/generated/')) return []
  if (!source.includes('legacy-http')) return []
  const entry = config.allow.find((prefix) => path.startsWith(prefix))
  if (entry !== undefined) {
    used.add(entry)
    return []
  }
  return [`${path}: imports legacy-http`]
}
