import { jsoncToJson } from './jsonc.mts'
import { parseYamlConfig } from './yaml-config.mts'

/**
 * The file name endings a config file may have. `.json` is read as JSONC too, so comments and
 * trailing commas are allowed in both; `.yaml` and `.yml` are YAML.
 */
export const CONFIG_EXTENSIONS = ['.json', '.jsonc', '.yaml', '.yml'] as const

/** Every name the reviewed repository's own file may have, at its root. */
export const TARGET_CONFIG_NAMES = CONFIG_EXTENSIONS.map((ext) => `.code-reviewer${ext}`)

export type ConfigFormat = 'JSON' | 'YAML'

/** The format a config file's name says it is in. */
export function configFormat(file: string): ConfigFormat {
  return file.endsWith('.yaml') || file.endsWith('.yml') ? 'YAML' : 'JSON'
}

/** A config file whose text is not valid in its format; the message says where when it can. */
export class ConfigParseError extends Error {
  format: ConfigFormat
  constructor(format: ConfigFormat, message: string, options?: ErrorOptions) {
    super(message, options)
    this.format = format
  }
}

/** What a config file's top level must be, in its format's words. */
export function topLevelNoun(file: string): string {
  return configFormat(file) === 'YAML' ? 'a YAML mapping' : 'a JSON object'
}

/** The problem for a config file whose text is not valid; a YAML one says where. */
export function invalidProblem(file: string, error: unknown): string {
  const { format, message } = error as ConfigParseError
  return `${file}: not valid ${format}${format === 'YAML' ? ` (${message})` : ''}; ignored`
}

/** The problem for a config file whose top level is not an object. */
export function notObjectProblem(file: string): string {
  return `${file}: must be ${topLevelNoun(file)}; ignored`
}

/** Parses a config file's text into plain data; throws `ConfigParseError` when it is not valid. */
export function parseConfigText(text: string, file: string): unknown {
  const format = configFormat(file)
  try {
    return format === 'YAML' ? parseYamlConfig(text) : JSON.parse(jsoncToJson(text))
  } catch (error) {
    throw new ConfigParseError(format, (error as Error).message, { cause: error })
  }
}

/**
 * Groups file names by name without extension, lowercased, so `acme.json` and `acme.yaml` land
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
