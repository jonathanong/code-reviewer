import type { CarriedFile } from './carried-file.mts'
import type { PushFile } from './push-file.mts'

export type PushSummary = Pick<
  PushFile,
  'kind' | 'reason' | 'mergesTotal' | 'mergesCapped' | 'resolvedPaths'
> & { merges: number; resolved: number }

export function pushSummary(push: PushFile): PushSummary {
  const { kind, reason, mergesTotal, mergesCapped, resolvedPaths } = push
  const resolved = push.merges.filter((merge) => merge.resolution === 'resolved').length
  return {
    kind,
    reason,
    merges: push.merges.length,
    resolved,
    mergesTotal,
    mergesCapped,
    resolvedPaths,
  }
}

export function pushFiles(push: PushFile): string[] {
  return [
    'push.json',
    ...(push.merges.length === 0 ? [] : ['merges/INDEX.md']),
    ...(push.rangeDiff === undefined ? [] : [push.rangeDiff]),
    ...(push.incoming === undefined ? [] : [push.incoming]),
  ]
}

/** What `prepare` prints about carried commits and a dead base branch. */
export type CarriedSummary = {
  commits: number
  inRange: number
  files: number
  base: CarriedFile['base']
  baseMergedIn?: number
}

export function carriedSummary(file: CarriedFile): CarriedSummary {
  return {
    commits: file.commits.length,
    inRange: file.commitsInRange,
    files: file.filesTotal,
    base: file.base,
    ...(file.baseMergedIn === undefined ? {} : { baseMergedIn: file.baseMergedIn }),
  }
}
