import type { RunTextCommand } from '../gh-cli/index.mts'

/** Local git in one checkout. */
export type TreeGit = (...args: string[]) => Promise<string>

export const treeGit =
  (git: RunTextCommand, tree: string): TreeGit =>
  (...args) =>
    git(['-C', tree, ...args])

const VERSION = /(\d+)\.(\d+)/u

/** `git show --remerge-diff` needs git 2.36. */
export async function supportsRemerge(git: TreeGit): Promise<boolean> {
  const match = VERSION.exec(await git('--version'))
  if (match === null) return false
  const [major, minor] = [Number(match[1]), Number(match[2])]
  return major > 2 || (major === 2 && minor >= 36)
}

/** The best common ancestor, or undefined when the commits share none. */
export async function mergeBase(git: TreeGit, a: string, b: string): Promise<string | undefined> {
  try {
    return (await git('merge-base', a, b)).trim() || undefined
  } catch {
    return undefined
  }
}

/** `ancestor` is reachable from `descendant`. */
export async function isAncestor(
  git: TreeGit,
  ancestor: string,
  descendant: string,
): Promise<boolean> {
  return (await mergeBase(git, ancestor, descendant)) === ancestor
}

export type Commit = { sha: string; parents: string[] }

/** The commits after `from` along the first-parent chain of `to`, newest first. */
export async function firstParentCommits(
  git: TreeGit,
  from: string,
  to: string,
): Promise<Commit[]> {
  const out = await git('rev-list', '--first-parent', '--parents', `${from}..${to}`)
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [sha, ...parents] = line.trim().split(' ') as [string, ...string[]]
      return { sha, parents }
    })
}

/** What the merge's author changed beyond git's own automatic merge; empty for a clean merge. */
export async function remergeDiff(git: TreeGit, sha: string): Promise<string> {
  const out = await git('show', '--remerge-diff', '--no-color', '--no-ext-diff', '--format=', sha)
  return out.trim() === '' ? '' : out
}

/** The plain diff between two commits, as a reviewer reads it. */
export const diffBetween = (git: TreeGit, from: string, to: string) =>
  git('diff', '--no-color', '--no-ext-diff', '--no-renames', from, to)

/**
 * The change `from..to` reduced to its file headers and its added and removed lines, so two diffs
 * of the same change against different bases compare equal: hunk positions and context lines drop
 * out, and binary content stays in.
 */
export async function changeSignature(git: TreeGit, from: string, to: string): Promise<string> {
  const diff = await git(
    'diff',
    '--no-color',
    '--no-ext-diff',
    '--no-renames',
    '--binary',
    '-U0',
    from,
    to,
  )
  return diff
    .split('\n')
    .filter((line) => !line.startsWith('index ') && !line.startsWith('@@'))
    .join('\n')
}

const PAIR = /^\s*\S+:\s+\S+\s+([=!<>])\s+\S+:\s+\S+/u

/**
 * `git range-diff` of the old commits against the new ones, or '' when every old commit pairs with
 * a new one (`=` identical, `!` differing in context or in how the change is split). Only an old
 * commit with no new one (`<`) or a new commit with no old one (`>`) shows a commit that was
 * squashed, dropped, split or added; the net change is compared separately.
 */
export async function nonTrivialRangeDiff(
  git: TreeGit,
  oldRange: string,
  newRange: string,
): Promise<string> {
  const out = await git('range-diff', '--no-color', oldRange, newRange)
  const pairs = out.split('\n').flatMap((line) => PAIR.exec(line)?.[1] ?? [])
  return pairs.every((mark) => mark === '=' || mark === '!') ? '' : out
}
