import { posix } from 'node:path'

import type { Consumes, RepoConfigs } from './config.mts'

/** A repository available to the reviewer: `repo` is `owner/name` when its origin is known. */
export type Linkable = { name: string; repo?: string }

/** A repository linked to the change by a declaration, with the heading the index shows. */
export type Link = { name: string; heading: string }

export type Links = { deps: Link[]; consumers: Link[]; missing: string[] }

/** The clone whose origin is `repo`; else one with no origin whose directory has its name. */
function resolve(candidates: readonly Linkable[], repo: string): Linkable | undefined {
  const name = repo.split('/')[1]
  return (
    candidates.find((candidate) => candidate.repo?.toLowerCase() === repo) ??
    candidates.find(
      (candidate) => candidate.repo === undefined && candidate.name.toLowerCase() === name,
    )
  )
}

/** Paths that renames in the diff moved files away from. */
function renamedFrom(diff: string): string[] {
  return [...diff.matchAll(/^rename from (.+)$/gmu)].map((match) => match[1] as string)
}

function describe(entry: Consumes): string {
  const via = entry.via === '' ? '' : ` via ${entry.via}`
  const paths = entry.paths.length === 0 ? '' : ` (${entry.paths.join(', ')})`
  return `${via}${paths}`
}

function touched(entry: Consumes, changed: readonly string[]): string | undefined {
  if (entry.paths.length === 0) return changed[0]
  return changed.find((path) => entry.paths.some((glob) => posix.matchesGlob(path, glob)))
}

/**
 * Resolves the reviewer's own configs for a change: the repositories the reviewed one consumes,
 * and the repositories that consume what this change touches.
 */
export function declaredLinks(input: {
  /** The reviewed repository's `owner/name`; nothing is declared for an unknown repository. */
  repoId?: string
  configs: RepoConfigs
  candidates: readonly Linkable[]
  changedPaths: readonly string[]
  /** The diff, for the paths its renames moved files away from. */
  diff?: string
}): Links {
  const links: Links = { deps: [], consumers: [], missing: [] }
  const id = input.repoId?.toLowerCase()
  if (id === undefined) return links
  for (const entry of input.configs.byRepo.get(id)?.consumes ?? []) {
    const hit = resolve(input.candidates, entry.repo)
    if (hit === undefined) {
      links.missing.push(`${entry.repo}: configured as consumed, but no clone of it was found`)
    } else if (!links.deps.some((dep) => dep.name === hit.name)) {
      links.deps.push({ name: hit.name, heading: `${hit.name}: consumed${describe(entry)}` })
    }
  }
  const changed = [...input.changedPaths, ...renamedFrom(input.diff ?? '')]
  for (const [consumer, config] of input.configs.byRepo) {
    const entry = config.consumes.find(
      (item) => item.repo === id && touched(item, changed) !== undefined,
    )
    if (entry === undefined) continue
    const hit = resolve(input.candidates, consumer)
    if (hit === undefined) {
      links.missing.push(`${consumer}: configured as a consumer, but no clone of it was found`)
      continue
    }
    const heading = `${hit.name}: consumes this repository${describe(entry)}; this change touches ${touched(entry, changed)}`
    links.consumers.push({ name: hit.name, heading })
  }
  return links
}
