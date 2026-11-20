import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

import { splitRepo, type RunTextCommand } from '../gh-cli/index.mts'
import { originRepo } from '../review/rules/sources.mts'

/** A checkout of the pull request head that `run` removes when it finishes, however it ends. */
export type Tree = {
  path: string
  kind: 'worktree' | 'clone'
  remove(): Promise<void>
}

/** The clone under `root` of `repo`: matched by its origin URL, or by directory name without one. */
export async function findClone(
  root: string,
  repo: string,
  git: RunTextCommand,
): Promise<string | undefined> {
  const wanted = repo.toLowerCase()
  const name = splitRepo(wanted).name
  const dirs = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, '.git')))
    .map((entry) => entry.name)
    .sort()
  for (const dir of dirs) {
    const origin = await originRepo(join(root, dir), git)
    if ((origin?.toLowerCase() ?? (dir.toLowerCase() === name ? wanted : '')) === wanted) {
      return join(root, dir)
    }
  }
  return undefined
}

export type TreeArgs = {
  repo: string
  headSha: string
  /** The directory of local clones, when one is set. */
  clones: string | undefined
  git: RunTextCommand
  /** Where the temporary directory goes: the OS temporary directory. */
  tmp: string
  /** The URL to clone when no local clone exists. */
  remote: (repo: string) => string
}

/**
 * Checks out `headSha` in a new directory under the OS temporary directory: a detached worktree of
 * the local clone after fetching the head, else a blobless clone. Nothing is left behind when the
 * checkout fails.
 */
export async function checkoutHead(args: TreeArgs): Promise<Tree> {
  const base = mkdtempSync(join(args.tmp, 'code-reviewer-run-'))
  const path = join(base, 'tree')
  const { git, headSha } = args
  const cleanup = () => rmSync(base, { recursive: true, force: true })
  try {
    const clone =
      args.clones === undefined || !existsSync(args.clones)
        ? undefined
        : await findClone(args.clones, args.repo, git)
    if (clone !== undefined) {
      await git(['-C', clone, 'fetch', '--quiet', 'origin', headSha])
      await git(['-C', clone, 'worktree', 'add', '--detach', path, headSha])
      return {
        path,
        kind: 'worktree',
        async remove() {
          try {
            await git(['-C', clone, 'worktree', 'remove', '--force', path])
          } finally {
            cleanup()
            await git(['-C', clone, 'worktree', 'prune'])
          }
        },
      }
    }
    await git([
      'clone',
      '--quiet',
      '--filter=blob:none',
      '--no-checkout',
      args.remote(args.repo),
      path,
    ])
    await git(['-C', path, 'fetch', '--quiet', 'origin', headSha])
    await git(['-C', path, 'checkout', '--quiet', '--detach', headSha])
    return { path, kind: 'clone', remove: async () => cleanup() }
  } catch (error) {
    cleanup()
    throw error
  }
}
