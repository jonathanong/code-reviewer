import { splitDiff, type DiffFile } from '../diff-files.mts'

/** A repo-relative path without a leading `./` or `/`, so `./a.ts` and `/a.ts` name `a.ts`. */
export function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//u, '').replace(/^\/+/u, '')
}

/** A renamed file matches on the path it had before as well as the one it has now. */
function pathsOf(file: DiffFile): string[] {
  const from = /^rename from (.+)$/mu.exec(file.text)?.[1]
  return [file.path, ...(from === undefined ? [] : [from])].map(normalizePath)
}

/**
 * The part of a pull request diff that touches `paths`, for `bench --only-path`. A case whose diff
 * touches none of them is a configuration problem, so it throws naming the case and the paths.
 * Without `paths` the diff is returned as it came.
 */
export function onlyPathDiff(
  id: string,
  diff: string,
  paths: readonly string[] | undefined,
): string {
  if (paths === undefined) return diff
  const wanted = new Set(paths.map(normalizePath))
  const kept = splitDiff(diff).filter((file) => pathsOf(file).some((path) => wanted.has(path)))
  if (kept.length === 0)
    throw new Error(`bench --only-path: case ${id} changes none of ${paths.join(', ')}.`)
  // The last file's text ends one blank line late, because the split keeps the diff's final newline.
  return kept
    .map((file) => file.text)
    .join('')
    .replace(/\n+$/u, '\n')
}
