import type { RunTextCommand } from '../gh-cli/index.mts'
import type { PullTarget } from './target.mts'

/** GitHub refuses to render a pull request diff above 300 files. */
export function isDiffTooLarge(error: unknown): boolean {
  return /too_large|maximum number of files/.test(error instanceof Error ? error.message : '')
}

/**
 * The pull request diff computed in a local checkout: the merge base of the base and head commits
 * against the head, which is what GitHub shows. The base commit is fetched first, since a checkout
 * of the head need not have it.
 */
export async function localPullDiff(
  target: PullTarget,
  run: RunTextCommand,
  git: RunTextCommand,
  tree: string,
): Promise<string> {
  const view = await run([
    'pr',
    'view',
    String(target.pr),
    '-R',
    target.repo,
    '--json',
    'baseRefOid,headRefOid',
  ])
  const { baseRefOid, headRefOid } = JSON.parse(view) as { baseRefOid: string; headRefOid: string }
  await git(['-C', tree, 'fetch', '--quiet', 'origin', baseRefOid])
  const mergeBase = (await git(['-C', tree, 'merge-base', baseRefOid, headRefOid])).trim()
  return git(['-C', tree, 'diff', '--no-color', '--no-ext-diff', mergeBase, headRefOid])
}
