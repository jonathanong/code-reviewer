import type { RunTextCommand } from '../gh-cli/index.mts'
import { hasCommit } from './carried-git.mts'
import { compareDiffs, type CarryComparison } from './carry-diff.mts'
import { mergeBase, treeGit, type TreeGit } from './push-git.mts'

export type CarryShas = {
  baseSha: string
  fromSha: string
  headSha: string
}

async function ensureCommits(git: TreeGit, shas: readonly string[]): Promise<void> {
  const missing: string[] = []
  for (const sha of shas) {
    if (!(await hasCommit(git, sha))) missing.push(sha)
  }
  if (missing.length === 0) return
  const errors = new Map<string, unknown>()
  let batchError: unknown
  try {
    await git('fetch', '--quiet', 'origin', ...missing)
  } catch (error) {
    batchError = error
    if (missing.length > 1) {
      for (const sha of missing) {
        try {
          await git('fetch', '--quiet', 'origin', sha)
        } catch (shaError) {
          errors.set(sha, shaError)
        }
      }
    }
  }
  for (const sha of missing) {
    if (!(await hasCommit(git, sha))) {
      const cause = errors.get(sha) ?? batchError
      throw new Error(
        `Commit ${sha} is not available in the local clone or origin.`,
        cause === undefined ? undefined : { cause },
      )
    }
  }
}

async function zeroContextDiff(git: TreeGit, base: string, head: string): Promise<string> {
  return git('diff', '--no-color', '--no-ext-diff', '--no-renames', '--binary', '-U0', base, head)
}

/** Computes `merge-base(OLD, base)..OLD` and `merge-base(NEW, base)..NEW` in `tree` and compares them. */
export async function diffHeadChanges(
  run: RunTextCommand,
  tree: string,
  shas: CarryShas,
): Promise<CarryComparison> {
  const git = treeGit(run, tree)
  await ensureCommits(git, [shas.baseSha, shas.fromSha, shas.headSha])
  const [oldBase, newBase] = await Promise.all([
    mergeBase(git, shas.fromSha, shas.baseSha),
    mergeBase(git, shas.headSha, shas.baseSha),
  ])
  if (oldBase === undefined || newBase === undefined) {
    throw new Error('Could not find a merge-base with the pull request base branch.')
  }
  const [oldDiff, newDiff] = await Promise.all([
    zeroContextDiff(git, oldBase, shas.fromSha),
    zeroContextDiff(git, newBase, shas.headSha),
  ])
  return compareDiffs(oldDiff, newDiff, shas.fromSha, shas.headSha)
}
