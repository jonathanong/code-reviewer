import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { splitDiff } from './diff-files.mts'
import { numberDiff } from './numbered-diff.mts'
import type { PushInspection, PushKind } from './push-types.mts'
import { writeDiffDir, type Write } from './write-diff.mts'

/** One merge as `push.json` records it. */
export type PushFileMerge = {
  sha: string
  resolution: 'clean' | 'resolved'
  /** Path of the resolution, relative to the run directory; absent for a clean merge. */
  file?: string
  truncated?: true
}

/** `push.json`, written by `prepare` for a re-review after a push that moved the head. */
export type PushFile = {
  kind: PushKind
  reason: string
  reviewedSha: string
  headSha: string
  merges: PushFileMerge[]
  /** More merges than were read. */
  mergesCapped: boolean
  mergesTotal: number
  /** Paths the merge resolutions touch. */
  resolvedPaths: string[]
  /** Path of the non-trivial range-diff, relative to the run directory. */
  rangeDiff?: string
  /** Path of the index of what came in from the base, relative to the run directory. */
  incoming?: string
  problems: string[]
}

const ARTIFACTS = ['push.json', 'merges', 'incoming', 'range-diff.txt']

/** Removes what an earlier run in the same directory left behind. */
export function clearPush(out: string): void {
  for (const name of ARTIFACTS) rmSync(join(out, name), { recursive: true, force: true })
}

/** Reads `push.json` from a run directory; undefined for a first review or an unchanged head. */
export function readPushFile(out: string): PushFile | undefined {
  const path = join(out, 'push.json')
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as PushFile) : undefined
}

const shortSha = (sha: string) => sha.slice(0, 12)

function renderIndex(merges: readonly PushFileMerge[], capped: boolean, total: number): string {
  const rows = merges.map(
    (merge) =>
      `- \`${shortSha(merge.sha)}\`: ${
        merge.file === undefined
          ? 'clean merge, nothing was resolved by hand'
          : `conflict resolution in \`${merge.file}\`${merge.truncated === true ? ' (cut: too large)' : ''}`
      }`,
  )
  return [
    '# Merge resolutions',
    '',
    "Each file is `git show --remerge-diff` of one merge: what the author changed beyond git's own automatic merge. The right-hand line numbers are lines of the merged file.",
    ...(capped ? ['', `Only ${merges.length} of ${total} merges are listed.`] : []),
    '',
    ...rows,
    '',
  ].join('\n')
}

/**
 * Writes `push.json` and what it points at: `merges/` (an index and one numbered patch per merge
 * that has a resolution), `incoming/` (the base's changes), and `range-diff.txt`.
 */
export function writePush(out: string, push: PushInspection, write: Write): PushFile {
  const merges: PushFileMerge[] = []
  const resolvedPaths = new Set<string>()
  if (push.merges.length > 0) mkdirSync(join(out, 'merges'), { recursive: true })
  for (const merge of push.merges) {
    if (merge.resolution === '') {
      merges.push({ sha: merge.sha, resolution: 'clean' })
      continue
    }
    const file = join('merges', `${shortSha(merge.sha)}.patch`)
    const numbered = numberDiff(merge.resolution)
    for (const entry of splitDiff(numbered)) resolvedPaths.add(entry.path)
    write(join(out, file), numbered)
    merges.push({
      sha: merge.sha,
      resolution: 'resolved',
      file,
      ...(merge.truncated ? { truncated: true as const } : {}),
    })
  }
  const capped = push.mergesTotal > push.merges.length
  if (merges.length > 0) {
    write(join(out, 'merges', 'INDEX.md'), renderIndex(merges, capped, push.mergesTotal))
  }
  if (push.rangeDiff !== undefined) write(join(out, 'range-diff.txt'), push.rangeDiff)
  if (push.incoming !== undefined) {
    writeDiffDir(join(out, 'incoming'), numberDiff(push.incoming.diff), write)
  }
  const file: PushFile = {
    kind: push.kind,
    reason: push.reason,
    reviewedSha: push.reviewedSha,
    headSha: push.headSha,
    merges,
    mergesCapped: capped,
    mergesTotal: push.mergesTotal,
    resolvedPaths: [...resolvedPaths],
    ...(push.rangeDiff === undefined ? {} : { rangeDiff: 'range-diff.txt' }),
    ...(push.incoming === undefined ? {} : { incoming: join('incoming', 'INDEX.md') }),
    problems: push.problems,
  }
  write(join(out, 'push.json'), `${JSON.stringify(file, null, 2)}\n`)
  return file
}
