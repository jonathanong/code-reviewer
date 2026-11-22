import { normalizePath } from './only-path.mts'

/**
 * Checks `bench --only-path` before any work and returns the normalized paths, without
 * duplicates; undefined when the flag is not given.
 */
export function onlyPaths(values: {
  'only-path'?: string[]
  'loads-only'?: boolean
}): string[] | undefined {
  const given = values['only-path']
  if (given === undefined) return undefined
  if (values['loads-only'] === true)
    throw new Error(
      'bench --only-path cannot be used with --loads-only: its report has no only-path label.',
    )
  const paths = given.map(normalizePath)
  if (paths.some((path) => path === ''))
    throw new Error('bench --only-path needs a repo-relative file path, such as "src/a.ts".')
  return [...new Set(paths)]
}

/**
 * The paths to label a run with: the flag, else what the saved results record, for
 * `--score-only`. Saved results that do not all record the same paths are not one arm, so they
 * are refused.
 */
export function grantedOnlyPath(
  flag: readonly string[] | undefined,
  saved: ReadonlyArray<readonly string[] | null>,
): string[] | undefined {
  if (flag !== undefined) return [...flag]
  const sets = new Set(saved.map((paths) => (paths ?? []).join('\n')))
  if (sets.size > 1)
    throw new Error(
      'bench: the saved results were run with different --only-path paths, so they are not one arm. Score them in separate --out directories.',
    )
  const found = saved[0] ?? []
  return found.length === 0 ? undefined : [...found]
}

/** The summary.md line that stops an experiment row passing for a normal one. */
export function onlyPathNote(paths: readonly string[]): string {
  return `Diff shown to the pillar agent: only ${paths.join(', ')}. This is an experiment, not what a review shows, so these rows are not comparable with normal rows.`
}
