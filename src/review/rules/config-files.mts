import { jsoncToJson } from './jsonc.mts'

/**
 * The file name endings a config file may have. `.json` is read as JSONC too, so comments and
 * trailing commas are allowed in both.
 */
export const CONFIG_EXTENSIONS = ['.json', '.jsonc'] as const

/** Every name the reviewed repository's own file may have, at its root. */
export const TARGET_CONFIG_NAMES = CONFIG_EXTENSIONS.map((ext) => `.code-reviewer${ext}`)

/** Parses a config file's text into plain data; throws when it is not valid. */
export function parseConfigText(text: string): unknown {
  return JSON.parse(jsoncToJson(text))
}

/**
 * Groups file names by name without extension, lowercased, so `acme.json` and `acme.jsonc` land
 * together; names with another ending are left out. Each group keeps the order given.
 */
export function groupConfigFiles(names: readonly string[]): Map<string, string[]> {
  const groups = new Map<string, string[]>()
  for (const name of names) {
    const ext = CONFIG_EXTENSIONS.find((candidate) => name.endsWith(candidate))
    if (ext === undefined) continue
    const key = name.slice(0, -ext.length).toLowerCase()
    groups.set(key, [...(groups.get(key) ?? []), name])
  }
  return groups
}

/** The problem for one config that exists in more than one format; none of the files is used. */
export function conflictProblem(files: readonly string[]): string {
  return `${files.join(' and ')}: more than one file for the same config; none is used`
}
