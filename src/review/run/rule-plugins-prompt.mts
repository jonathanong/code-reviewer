import { DEFAULT_RULE_PLUGINS } from '../plugins.mts'

const quoted = (names: readonly string[]): string => {
  const ticks = names.map((name) => `\`${name}\``)
  return ticks.length < 2
    ? ticks.join('')
    : `${ticks.slice(0, -1).join(', ')} and ${ticks[ticks.length - 1]}`
}

/** How the pillar files write the default plugins, which the default list renders unchanged. */
const DEFAULT_NAMES = quoted(DEFAULT_RULE_PLUGINS)

/** The "Shared rule skills" bullet of the pillar contract and of the rules pillar. */
const BULLET = /^- ((?:\*\*)?Shared rule skills(?:\*\*)?):[\s\S]*?(?=\n- |\n\n|(?![\s\S]))/mu

const NOT_LOADED = ' A pillar file may name a skill from a plugin this run does not load; skip it.'

/**
 * A pillar file with its shared-rules bullet rendered for the configured `rulePlugins`. The
 * default list returns `text` itself, so the prompts of a default run do not change; another list
 * replaces the names in the bullet (and, with `note`, adds that a pillar file may name a skill
 * this run does not load), and an empty list replaces the bullet with repository rules only.
 */
export function renderRulePlugins(text: string, names: readonly string[], note = false): string {
  if (isDefault(names)) return text
  return text.replace(BULLET, (bullet, label: string) => {
    if (names.length === 0) {
      return `- ${label}: no shared rule plugins are configured, so rules come only from this repository's \`AGENTS.md\` and skills. Skip any skill a pillar file names.`
    }
    const list = quoted(names)
    const named = bullet
      .replaceAll(DEFAULT_NAMES, list)
      .replaceAll(`${list} plugins`, names.length === 1 ? `${list} plugin` : `${list} plugins`)
    return `${named}${note ? NOT_LOADED : ''}`
  })
}

const isDefault = (names: readonly string[]) =>
  names.length === DEFAULT_RULE_PLUGINS.length &&
  names.every((name, index) => name === DEFAULT_RULE_PLUGINS[index])

/**
 * One line for a run that reads the pillar contract from its file, where the bullet still names
 * the default plugins. Empty for the default list (and when unknown), so those prompts do not change.
 */
export function rulePluginLines(names: readonly string[] | undefined): string[] {
  if (names === undefined || isDefault(names)) return []
  return names.length === 0
    ? [
        'No shared rule plugins are configured for this run: where the contract names plugins, rules come only from this repository.',
      ]
    : [`The shared rule plugins of this run are ${quoted(names)}, not the ones the contract names.`]
}
