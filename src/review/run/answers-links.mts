import { readFileSync } from 'node:fs'
import { basename, dirname, join, sep } from 'node:path'

import type { PluginInstall } from '../plugins.mts'

/** Where a plugin lives on GitHub: the repository, the ref its files are read at, and its directory in it. */
export type PluginLocation = { repository: string; ref: string; dir: string }

type Json = Record<string, unknown>

const REPO_RE = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+$/u
const OWNER_REPO_RE = /^[\w.-]+\/[\w.-]+$/u
const REF_RE = /^[\w][\w./-]*$/u
const DIR_RE = /^[\w.-]+(?:\/[\w.-]+)*$/u

const asJson = (value: unknown): Json | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : undefined

function readJson(file: string): Json | undefined {
  try {
    return asJson(JSON.parse(readFileSync(file, 'utf8')))
  } catch {
    return undefined
  }
}

/** `https://github.com/<owner>/<repo>` from a GitHub clone URL or an `owner/repo`; else undefined. */
function githubRepository(url: unknown, ownerRepo = false): string | undefined {
  if (typeof url !== 'string') return undefined
  const plain = url.replace(/\.git$/u, '').replace(/\/$/u, '')
  const full = ownerRepo && OWNER_REPO_RE.test(plain) ? `https://github.com/${plain}` : plain
  return REPO_RE.test(full) ? full : undefined
}

/** The directory a source path names, `''` for the repository root; undefined when it leaves the repository. */
function directory(path: unknown): string | undefined {
  if (typeof path !== 'string') return undefined
  const plain = path.replace(/^\.\//u, '').replace(/\/$/u, '')
  if (plain === '' || plain === '.') return ''
  return DIR_RE.test(plain) && !plain.split('/').includes('..') ? plain : undefined
}

const refOf = (source: Json | undefined): string =>
  typeof source?.ref === 'string' && REF_RE.test(source.ref) ? source.ref : 'HEAD'

/**
 * The repository, ref and directory of an installed plugin, from the marketplace it was installed
 * from: its `known_marketplaces.json` entry, and the plugin's entry in the marketplace's
 * `marketplace.json`. A string source is a path in the marketplace's own repository; an object
 * source names its own repository and, for a subdirectory, a `path`. Undefined unless all of it is
 * certain, so a link is never built from a guess.
 */
export function pluginLocation(install: PluginInstall): PluginLocation | undefined {
  const { marketplace, installPath } = install
  const parts = installPath.split(sep)
  const cache = parts.lastIndexOf('cache')
  if (marketplace === undefined || cache < 1 || parts[cache + 1] !== marketplace) return undefined
  const plugins = parts.slice(0, cache).join(sep)
  const known = asJson(readJson(join(plugins, 'known_marketplaces.json'))?.[marketplace])
  const home = asJson(known?.source)
  const listing = typeof known?.installLocation === 'string' ? known.installLocation : undefined
  const catalog = readJson(join(listing ?? '', '.claude-plugin', 'marketplace.json'))
  if (home === undefined || listing === undefined || catalog === undefined) return undefined
  if (asJson(catalog.metadata)?.pluginRoot !== undefined) return undefined
  const entries = Array.isArray(catalog.plugins) ? catalog.plugins : []
  const entry = asJson(entries.find((candidate) => asJson(candidate)?.name === install.name))
  const source = entry?.source
  if (typeof source === 'string') {
    const dir = directory(source)
    const repository = githubRepository(home.url ?? home.repo, home.repo !== undefined)
    return dir === undefined || repository === undefined
      ? undefined
      : { repository, ref: refOf(home), dir }
  }
  const own = asJson(source)
  const repository = githubRepository(own?.url ?? own?.repo, own?.repo !== undefined)
  const dir = own?.path === undefined ? '' : directory(own.path)
  return own === undefined || repository === undefined || dir === undefined
    ? undefined
    : { repository, ref: refOf(own), dir }
}

/**
 * The link of a skill whose SKILL.md is `file`, in a plugin at `location`; undefined without a
 * location, so no link is ever guessed.
 */
export function skillUrl(location: PluginLocation | undefined, file: string): string | undefined {
  if (location === undefined) return undefined
  const base = location.dir === '' ? '' : `${location.dir}/`
  return `${location.repository}/blob/${location.ref}/${base}skills/${basename(dirname(file))}/SKILL.md`
}
