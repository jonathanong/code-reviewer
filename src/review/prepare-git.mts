import type { RunTextCommand } from '../gh-cli/index.mts'

const MAX_HISTORY_PATHS = 50

/** `git grep` in `tree`; resolves `''` when nothing matched (exit 1) and rejects on any other failure. */
export async function docGrep(git: RunTextCommand, tree: string, args: string[]): Promise<string> {
  try {
    return await git(['-C', tree, ...args])
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return ''
    throw error
  }
}

/** Commit subjects touching `paths` in the year before `base`; `undefined` when the base is unknown. */
export async function commitSubjects(
  git: RunTextCommand,
  tree: string,
  base: string,
  paths: readonly string[],
): Promise<string[] | undefined> {
  try {
    const out = await git([
      '-C',
      tree,
      'log',
      '--since=12.months',
      '--format=%s',
      base,
      '--',
      ...paths.slice(0, MAX_HISTORY_PATHS),
    ])
    return out.split('\n').filter((line) => line.trim().length > 0)
  } catch {
    // The base commit is not in the checkout: history is unknown, not a failure.
    return undefined
  }
}
