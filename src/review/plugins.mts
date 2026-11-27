/** An enabled Claude Code plugin: `name@marketplace` and its installed version. */
export type Plugin = { id: string; version: string }

type Listed = { id?: unknown; version?: unknown; enabled?: unknown; projectPath?: unknown }

/**
 * Reads `claude plugin list --json`: the plugins enabled for the user or for the project at `cwd`,
 * sorted. Entries for other projects are ignored.
 */
export function parsePluginList(stdout: string, cwd: string): Plugin[] {
  const listed = JSON.parse(stdout) as unknown
  if (!Array.isArray(listed)) throw new Error('claude plugin list did not print an array.')
  const found = new Map<string, Plugin>()
  for (const entry of listed as Listed[]) {
    if (typeof entry?.id !== 'string' || entry.enabled !== true) continue
    if (entry.projectPath !== undefined && entry.projectPath !== cwd) continue
    const version = typeof entry.version === 'string' ? entry.version : 'unknown'
    const plugin = { id: entry.id, version }
    // A project entry is listed after the user entry and is the one in effect there.
    found.set(plugin.id, plugin)
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id))
}

/** `name@marketplace version` lines, for recording what a run had installed. */
export function pluginLabels(plugins: readonly Plugin[]): string[] {
  return plugins.map((plugin) => `${plugin.id} ${plugin.version}`)
}

/** Which of the `required` plugin names (the part before `@`) are not enabled. */
export function checkPlugins(
  plugins: readonly Plugin[],
  required: readonly string[],
): { plugins: string[]; missing: string[] } {
  const names = new Set(plugins.map((plugin) => plugin.id.split('@')[0]))
  return {
    plugins: pluginLabels(plugins),
    missing: required.filter((name) => !names.has(name)),
  }
}

/**
 * The plugins whose skills hold the shared review rules when no machine config sets
 * `rulePlugins`. Benchmarks always use this list.
 */
export const DEFAULT_RULE_PLUGINS: readonly string[] = [
  'no-mistakes-rules',
  'ratchet-workflows',
  'ratchet-github',
  'ratchet-backend',
  'ratchet-code',
]

/**
 * The `--settings` value for a headless run: only the `rulePlugins` stay on (none when `rules` is
 * false, for a control), and every other plugin is switched off.
 */
export function pluginSettings(
  plugins: readonly Plugin[],
  rulePlugins: readonly string[],
  rules = true,
): { enabledPlugins: Record<string, boolean> } {
  const enabled = plugins.map((plugin): [string, boolean] => [
    plugin.id,
    rules && rulePlugins.includes(plugin.id.split('@')[0] as string),
  ])
  return { enabledPlugins: Object.fromEntries(enabled) }
}

/** An enabled user-scope plugin and where Claude Code installed it. */
export type PluginInstall = { name: string; installPath: string; marketplace?: string }

/** What a review needs from one `claude plugin list --json`: what is enabled and where it lives. */
export type PluginInfo = { enabled: Plugin[]; installs: PluginInstall[] }

type Installed = { id?: unknown; scope?: unknown; enabled?: unknown; installPath?: unknown }

/**
 * Reads install directories from `claude plugin list --json`. Only user-scope entries count:
 * headless runs read user settings at most, so a project-scoped plugin is not loadable there.
 */
export function parsePluginInstalls(stdout: string): PluginInstall[] {
  const listed = JSON.parse(stdout) as unknown
  if (!Array.isArray(listed)) throw new Error('claude plugin list did not print an array.')
  const found: PluginInstall[] = []
  for (const entry of listed as Array<Installed | null>) {
    if (typeof entry?.id !== 'string' || entry.enabled !== true || entry.scope !== 'user') continue
    if (typeof entry.installPath !== 'string') continue
    const [name = '', marketplace] = entry.id.split('@')
    found.push({
      name,
      installPath: entry.installPath,
      ...(marketplace === undefined || marketplace === '' ? {} : { marketplace }),
    })
  }
  return found
}

/** The message for `rulePlugins` entries a headless run cannot load. */
export function unloadableMessage(names: readonly string[]): string {
  return `rule plugins missing or not enabled at user scope: ${names.join(', ')}`
}

/**
 * The `rulePlugins` entries with no user-scope install. `parsePluginInstalls` keeps only enabled
 * user-scope plugins, the only ones a headless run loads, so this is stricter than `checkPlugins`.
 */
export function unloadableRulePlugins(
  installs: readonly PluginInstall[],
  rulePlugins: readonly string[],
): string[] {
  return rulePlugins.filter((name) => !installs.some((install) => install.name === name))
}
