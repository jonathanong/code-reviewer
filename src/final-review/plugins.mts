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
