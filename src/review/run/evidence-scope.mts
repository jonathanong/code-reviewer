import type { Exec } from '../benchmark/exec.mts'

/**
 * What a saved evidence item covers. `paths` lists repository files, or directories written with a
 * trailing `/`, that the result depends on. `unknown` is the default: a model chose the commands,
 * so nothing says which files a result rests on.
 */
export type EvidenceScope = { kind: 'paths'; paths: string[] } | { kind: 'unknown' }

/** The head an evidence item ran against and what it covers; both are absent in an older save. */
export type EvidenceStamp = { headSha?: string; scope?: EvidenceScope }

export type EvidenceHolds = 'holds' | 'stale' | 'unknown'

export const UNKNOWN_SCOPE: EvidenceScope = { kind: 'unknown' }

const covers = (scope: string, changed: string): boolean =>
  scope.endsWith('/') ? changed.startsWith(scope) : changed === scope

/**
 * Whether a saved evidence item still holds after `changedPaths` changed between its `headSha` and
 * the head being reviewed. It holds only when its scope is known and no changed path is inside it;
 * a missing sha, a missing, empty or unknown scope never holds. This is the basis for reusing an
 * earlier review's evidence; no review step reuses it yet.
 */
export function evidenceHolds(item: EvidenceStamp, changedPaths: readonly string[]): EvidenceHolds {
  const { headSha, scope } = item
  if (headSha === undefined || scope === undefined || scope.kind !== 'paths') return 'unknown'
  if (scope.paths.length === 0) return 'unknown'
  const touched = changedPaths.some((changed) => scope.paths.some((path) => covers(path, changed)))
  return touched ? 'stale' : 'holds'
}

/** The paths that differ between two commits of the checkout, or undefined when git cannot say. */
export async function pathsChangedBetween(
  exec: Exec,
  tree: string,
  from: string,
  to: string,
): Promise<string[] | undefined> {
  try {
    // --no-renames lists a moved file under both names, so a file moved out of a scope still counts.
    const out = await exec('git', [
      '-C',
      tree,
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      `${from}..${to}`,
    ])
    return out.split('\0').filter((path) => path !== '')
  } catch {
    return undefined
  }
}
