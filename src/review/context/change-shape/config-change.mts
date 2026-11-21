import { CONFIG_KEYS_MAX, CONFIG_KEYS_MAX_CHARS, changedKeys } from './config-keys.mts'
import type { ConfigChange, FileChange } from './types.mts'

const NO_KEYS = (path: string): ConfigChange => ({ path, keys: null, moreKeys: 0 })

/** A file's text at a revision; null when the file is absent there or cannot be read. */
async function show(
  git: (args: string[]) => Promise<string>,
  rev: string,
  path: string,
): Promise<string | null> {
  try {
    return await git(['show', `${rev}:${path}`])
  } catch {
    return null
  }
}

/** The changed keys of a small JSON config file; any other file is listed without keys. */
export async function configChange(
  file: FileChange,
  mergeBase: string | null,
  headSha: string,
  git: (args: string[]) => Promise<string>,
): Promise<ConfigChange> {
  if (!/\.jsonc?$/u.test(file.path) || mergeBase === null) return NO_KEYS(file.path)
  const added = file.status === 'A'
  const deleted = file.status === 'D'
  const before = added ? null : await show(git, mergeBase, file.oldPath ?? file.path)
  const after = deleted ? null : await show(git, headSha, file.path)
  if ((before === null && !added) || (after === null && !deleted)) return NO_KEYS(file.path)
  if (
    (before ?? '').length > CONFIG_KEYS_MAX_CHARS ||
    (after ?? '').length > CONFIG_KEYS_MAX_CHARS
  ) {
    return NO_KEYS(file.path)
  }
  const keys = changedKeys(before, after)
  if (keys === null) return NO_KEYS(file.path)
  return {
    path: file.path,
    keys: keys.slice(0, CONFIG_KEYS_MAX),
    moreKeys: Math.max(0, keys.length - CONFIG_KEYS_MAX),
  }
}
