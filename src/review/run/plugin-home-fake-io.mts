import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PluginInstall } from '../plugins.mts'

export const SKILL_TEXT =
  '---\nname: locks\ndescription: When code may take a lock.\n---\n\n# Locks\n\n- Take a lock only on a row that the transaction writes.\n'

export type HomeOptions = {
  /** How the marketplace was added, as `known_marketplaces.json` records it. */
  source?: unknown
  /** The plugin's `source` in the marketplace's `marketplace.json`; the plugin is left out when undefined. */
  entry?: unknown
  /** Other keys of `marketplace.json`, such as `metadata`. */
  catalog?: object
  /** Leave the marketplace out of `known_marketplaces.json`. */
  unknown?: boolean
  /** Write `marketplace.json` as this text instead. */
  rawCatalog?: string
  /** The marketplace name in the install, and the directory under `cache/`. */
  marketplace?: string | null
}

/**
 * A synthetic Claude plugins directory holding one plugin `rules` with one skill `locks`, and the
 * `PluginInstall` for it. Nothing here is read from the machine.
 */
export function pluginHome(options: HomeOptions = {}): PluginInstall {
  const root = mkdtempSync(join(tmpdir(), 'plugin-home-'))
  const plugins = join(root, 'plugins')
  const name = options.marketplace === undefined ? 'market' : options.marketplace
  const installPath = join(plugins, 'cache', name ?? 'market', 'rules', '1')
  const listing = join(plugins, 'marketplaces', 'market')
  mkdirSync(join(installPath, 'skills', 'locks'), { recursive: true })
  writeFileSync(join(installPath, 'skills', 'locks', 'SKILL.md'), SKILL_TEXT)
  mkdirSync(join(listing, '.claude-plugin'), { recursive: true })
  const known =
    options.unknown === true ? {} : { market: { source: options.source, installLocation: listing } }
  writeFileSync(join(plugins, 'known_marketplaces.json'), JSON.stringify(known))
  const plugin = options.entry === undefined ? [] : [{ name: 'rules', source: options.entry }]
  const catalog =
    options.rawCatalog ?? JSON.stringify({ name: 'market', plugins: plugin, ...options.catalog })
  writeFileSync(join(listing, '.claude-plugin', 'marketplace.json'), catalog)
  return { name: 'rules', installPath, ...(name === null ? {} : { marketplace: name }) }
}
