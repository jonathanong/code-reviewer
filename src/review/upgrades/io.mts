import type { RunTextCommand } from '../../gh-cli/index.mts'
import type { DiffDirs } from './diff.mts'
import type { Fetcher } from './registry.mts'

/** The git and registry reads of the upgrade step, injectable for tests. */
export type UpgradeIo = {
  /** The merge base of two commits in `tree`: the old side of the pull request's diff. */
  mergeBase(tree: string, a: string, b: string): Promise<string>
  /** A file's text at `sha` in `tree`; undefined when it does not exist there. */
  fileAt(tree: string, sha: string, path: string): Promise<string | undefined>
  diffDirs: DiffDirs
  fetcher: Fetcher
}

export function createUpgradeIo(git: RunTextCommand, fetcher: Fetcher = fetch): UpgradeIo {
  return {
    async mergeBase(tree, a, b) {
      return (await git(['-C', tree, 'merge-base', a, b])).trim()
    },
    async fileAt(tree, sha, path) {
      try {
        return await git(['-C', tree, 'show', `${sha}:${path}`])
      } catch {
        return undefined
      }
    },
    async diffDirs(parent) {
      try {
        return await git([
          '-C',
          parent,
          '-c',
          'core.quotepath=off',
          'diff',
          '--no-index',
          '--no-color',
          '--no-ext-diff',
          '--no-textconv',
          '--no-renames',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          '--',
          'old',
          'new',
        ])
      } catch (error) {
        // `git diff --no-index` exits 1 when the directories differ; its stdout is the patch.
        const { code, stdout } = error as { code?: unknown; stdout?: unknown }
        if (code === 1 && typeof stdout === 'string') return stdout
        throw error
      }
    },
    fetcher,
  }
}
