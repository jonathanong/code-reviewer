import type { RunTextCommand } from '../gh-cli/index.mts'
import type { PullTarget } from './target.mts'

/**
 * The diff of `headSha` against its merge base with `baseSha`, computed in a local checkout, which
 * is what GitHub shows for a pull request. Local git has no size limit, where GitHub refuses a
 * diff above 300 files. Both commits are fetched from origin by sha first, since a checkout of one
 * head need not have them.
 */
export async function localDiffBetween(
  git: RunTextCommand,
  tree: string,
  baseSha: string,
  headSha: string,
): Promise<string> {
  await git(['-C', tree, 'fetch', '--quiet', 'origin', baseSha, headSha])
  const mergeBase = (await git(['-C', tree, 'merge-base', baseSha, headSha])).trim()
  return git(['-C', tree, 'diff', '--no-color', '--no-ext-diff', mergeBase, headSha])
}

/** The pull request diff computed in a local checkout, with the commits read from the API. */
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
  return localDiffBetween(git, tree, baseRefOid, headRefOid)
}
