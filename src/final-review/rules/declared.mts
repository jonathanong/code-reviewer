import { posix } from 'node:path'

import { readRepoConfig, type Consumes } from './config.mts'
import type { RuleReader } from './reader.mts'

/** A repository available to the reviewer: `repo` is `owner/name` when its origin is known. */
export type Linkable = { name: string; repo?: string; reader: RuleReader }

/** A repository linked to the change by a declaration, with the heading the index shows. */
export type Link = { name: string; heading: string }

export type Links = { deps: Link[]; consumers: Link[]; missing: string[] }

function matches(candidate: Linkable, repo: string): boolean {
  if (candidate.repo !== undefined) return candidate.repo.toLowerCase() === repo
  return candidate.name.toLowerCase() === repo.split('/')[1]
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
 * Resolves the declarations in each repository's config file: the repositories the reviewed one
 * says it consumes, and the candidates that say they consume what this change touches.
 */
export async function declaredLinks(input: {
  /** The reviewed repository at its base. */
  repo?: { reader: RuleReader }
  /** The reviewed repository's `owner/name`; consumers are found only when it is known. */
  repoId?: string
  candidates: readonly Linkable[]
  changedPaths: readonly string[]
}): Promise<Links> {
  const links: Links = { deps: [], consumers: [], missing: [] }
  if (input.repo !== undefined) {
    const config = await readRepoConfig(input.repo.reader)
    links.missing.push(...config.problems.map((problem) => `This repository: ${problem}`))
    for (const entry of config.consumes) {
      const hit = input.candidates.find((candidate) => matches(candidate, entry.repo))
      if (hit === undefined) {
        links.missing.push(`${entry.repo}: declared as consumed, but no clone of it was found`)
      } else if (!links.deps.some((dep) => dep.name === hit.name)) {
        links.deps.push({ name: hit.name, heading: `${hit.name}: consumed${describe(entry)}` })
      }
    }
  }
  const id = input.repoId?.toLowerCase()
  if (id === undefined) return links
  for (const candidate of input.candidates) {
    const config = await readRepoConfig(candidate.reader)
    const entries = config.consumes.filter((item) => item.repo === id)
    // Every clone is scanned, so only a file that cannot be read at all, or one that names this
    // repository, is worth reporting; notes about unrelated clones would drown the rest.
    if (config.unreadable === true || entries.length > 0) {
      links.missing.push(...config.problems.map((problem) => `${candidate.name}: ${problem}`))
    }
    for (const entry of entries) {
      const path = touched(entry, input.changedPaths)
      if (path === undefined || links.consumers.some((link) => link.name === candidate.name)) {
        continue
      }
      const heading = `${candidate.name}: consumes this repository${describe(entry)}; this change touches ${path}`
      links.consumers.push({ name: candidate.name, heading })
    }
  }
  return links
}
