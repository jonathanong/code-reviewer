import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** Where a carried commit already lives: the default branch, or an open pull request. */
export type CarriedHome = { kind: 'default' } | { kind: 'pull'; number: number }

/** How git proved it: same commit, same patch, or the same file contents (squash-merged). */
export type CarriedHow = 'ancestor' | 'patch' | 'content'

export type CarriedCommit = { sha: string; subject: string; home: CarriedHome; how: CarriedHow }

export type BaseState = 'none' | 'default' | 'present' | 'missing' | 'unknown'

/** What local git proved about the pull request's commits and base branch. */
export type CarriedInspection = {
  /** Commits of the pull request's own diff range that already exist elsewhere. */
  commits: CarriedCommit[]
  /** Commits in the diff range, merges excluded. */
  commitsInRange: number
  /** Files changed only by carried commits; a file an own commit also touches is not listed. */
  files: string[]
  filesTotal: number
  defaultBranch: string | null
  base: BaseState
  problems: string[]
}

/** `carried.json`, written by `prepare` when something is carried or the base needs a note. */
export type CarriedFile = CarriedInspection & {
  baseRef: string | null
  /** The merged pull request whose head branch is the base. */
  baseMergedIn?: number
}

export const CARRIED_FILE = 'carried.json'

export const clearCarried = (out: string) => rmSync(join(out, CARRIED_FILE), { force: true })

/** Reads `carried.json` from a run directory; undefined when nothing was carried. */
export function readCarriedFile(out: string): CarriedFile | undefined {
  const path = join(out, CARRIED_FILE)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as CarriedFile) : undefined
}

/** The base branch is gone or landed, so the diff may hold its changes. */
export const baseIsDead = (file: CarriedFile) =>
  file.base === 'missing' || file.baseMergedIn !== undefined
