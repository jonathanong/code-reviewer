import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MANIFEST = join('.claude-plugin', 'plugin.json')

/** The nearest directory at or above one of `starts` that holds the plugin manifest. */
export function findPluginRoot(
  starts: readonly string[],
  exists: (path: string) => boolean = existsSync,
): string | undefined {
  for (const start of starts) {
    let dir = start
    for (;;) {
      if (exists(join(dir, MANIFEST))) return dir
      const parent = dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  }
  return undefined
}

/**
 * Where the plugin is installed. This module's own location answers when the CLI runs from source
 * or as a bundle in the plugin's `bin/`; a compiled binary has a virtual module path, so the
 * executable's location is tried next.
 */
export function pluginRoot(
  starts: readonly string[] = [fileURLToPath(import.meta.url), process.execPath],
): string {
  const root = findPluginRoot(starts)
  if (root === undefined) {
    throw new Error(
      `code-reviewer: no ${MANIFEST} above ${starts.join(' or ')}; run it from the installed plugin.`,
    )
  }
  return root
}
