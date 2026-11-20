import type { RunTextCommand } from '../gh-cli/index.mts'
import {
  changeSignature,
  diffBetween,
  firstParentCommits,
  isAncestor,
  mergeBase,
  nonTrivialRangeDiff,
  remergeDiff,
  supportsRemerge,
  treeGit,
  type Commit,
  type TreeGit,
} from './push-git.mts'
import {
  MAX_INCOMING_BYTES,
  MAX_MERGES,
  MAX_RANGE_DIFF_BYTES,
  MAX_RESOLUTION_BYTES,
  type MergeResolution,
  type PushInspection,
} from './push-types.mts'

export type PushShas = { reviewedSha: string; baseSha: string; headSha: string }

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] as string

function cut(text: string, limit: number): { text: string; truncated: boolean } {
  if (Buffer.byteLength(text) <= limit) return { text, truncated: false }
  return { text: Buffer.from(text).subarray(0, limit).toString(), truncated: true }
}

const substantive = (
  shas: PushShas,
  reason: string,
  rest: Partial<PushInspection> = {},
): PushInspection => ({
  kind: 'substantive',
  reason,
  reviewedSha: shas.reviewedSha,
  headSha: shas.headSha,
  merges: [],
  mergesTotal: 0,
  problems: [],
  ...rest,
})

/** The merge commit brings in only commits the base already has. */
async function mergesBase(git: TreeGit, commit: Commit, baseSha: string): Promise<boolean> {
  const brought = await Promise.all(commit.parents.slice(1).map((p) => isAncestor(git, p, baseSha)))
  return brought.every(Boolean)
}

async function resolveMerges(
  git: TreeGit,
  commits: readonly Commit[],
): Promise<{ merges: MergeResolution[]; total: number; problem?: string }> {
  const all = commits.filter((commit) => commit.parents.length > 1).reverse()
  if (all.length === 0) return { merges: [], total: 0 }
  if (!(await supportsRemerge(git))) {
    return { merges: [], total: all.length, problem: 'git is older than 2.36 (no remerge-diff)' }
  }
  try {
    const merges = await Promise.all(
      all.slice(0, MAX_MERGES).map(async ({ sha }) => {
        const { text, truncated } = cut(await remergeDiff(git, sha), MAX_RESOLUTION_BYTES)
        return { sha, resolution: text, truncated }
      }),
    )
    return { merges, total: all.length }
  } catch (error) {
    return { merges: [], total: all.length, problem: `remerge-diff failed: ${firstLine(error)}` }
  }
}

/** What the base changed between the two fork points, or the reason it cannot be read. */
async function incomingFrom(git: TreeGit, from: string, to: string) {
  const { text, truncated } = cut(await diffBetween(git, from, to), MAX_INCOMING_BYTES)
  return truncated ? undefined : { from, to, diff: text }
}

async function extension(git: TreeGit, shas: PushShas, commits: Commit[]): Promise<PushInspection> {
  const { reviewedSha, baseSha, headSha } = shas
  const { merges, total, problem } = await resolveMerges(git, commits)
  const own = { merges, mergesTotal: total, problems: problem === undefined ? [] : [problem] }
  if (total === 0) return substantive(shas, 'The new commits are not all merges.')
  if (problem !== undefined)
    return substantive(shas, 'The merge resolutions could not be read.', own)
  const bases = await Promise.all(commits.map((commit) => mergesBase(git, commit, baseSha)))
  const onlyBase = commits.every((commit, at) => commit.parents.length > 1 && bases[at])
  if (!onlyBase) return substantive(shas, 'The new commits are not only merges of the base.', own)
  if (total > MAX_MERGES) return substantive(shas, `More than ${MAX_MERGES} merges.`, own)
  if (merges.some((merge) => merge.truncated)) {
    return substantive(shas, 'A merge resolution is too large to list.', own)
  }
  const from = await mergeBase(git, reviewedSha, baseSha)
  const to = await mergeBase(git, headSha, baseSha)
  const incoming =
    from === undefined || to === undefined ? undefined : await incomingFrom(git, from, to)
  if (incoming === undefined) {
    return substantive(shas, 'What came in from the base could not be listed.', own)
  }
  return {
    ...substantive(shas, 'Every new commit merges the base.', own),
    kind: 'base-merges-only',
    incoming,
  }
}

async function rewrite(git: TreeGit, shas: PushShas): Promise<PushInspection> {
  const { reviewedSha, baseSha, headSha } = shas
  const [oldFork, newFork] = await Promise.all([
    mergeBase(git, reviewedSha, baseSha),
    mergeBase(git, headSha, baseSha),
  ])
  if (oldFork === undefined || newFork === undefined) {
    return substantive(shas, 'History was rewritten and the fork point is unknown.', {
      problems: ['The reviewed head and the head share no ancestor with the base.'],
    })
  }
  const [before, after] = await Promise.all([
    changeSignature(git, oldFork, reviewedSha),
    changeSignature(git, newFork, headSha),
  ])
  if (before !== after) {
    return substantive(shas, "History was rewritten and the pull request's own change differs.")
  }
  const incoming = await incomingFrom(git, oldFork, newFork)
  if (incoming === undefined) {
    return substantive(shas, 'What came in from the base could not be listed.')
  }
  const range = cut(
    await nonTrivialRangeDiff(git, `${oldFork}..${reviewedSha}`, `${newFork}..${headSha}`),
    MAX_RANGE_DIFF_BYTES,
  )
  return {
    ...substantive(shas, "History was rewritten and the pull request's own change is the same."),
    kind: 'rebase-same-change',
    incoming,
    ...(range.text === '' ? {} : { rangeDiff: range.text }),
  }
}

/**
 * Classifies what was pushed since the last trusted review, in the local checkout. A push is light
 * only when git proves it: every new commit merges the base (each merge's resolution is read), or
 * history was rewritten and the change against the base is the same. Anything git cannot answer is
 * `substantive`, with the reason in `problems`.
 */
export async function inspectPush(
  run: RunTextCommand,
  tree: string,
  shas: PushShas,
): Promise<PushInspection> {
  const git = treeGit(run, tree)
  try {
    // The reviewed head may have been force-pushed away; a failed fetch shows up as a missing commit.
    await git('fetch', '--quiet', 'origin', shas.reviewedSha, shas.baseSha, shas.headSha).catch(
      () => '',
    )
    await git('cat-file', '-e', `${shas.reviewedSha}^{commit}`)
    await git('cat-file', '-e', `${shas.baseSha}^{commit}`)
  } catch {
    return substantive(shas, 'The reviewed head or the base is not in the checkout.', {
      problems: ['The reviewed head or the base could not be fetched into the checkout.'],
    })
  }
  try {
    if (!(await isAncestor(git, shas.reviewedSha, shas.headSha))) return await rewrite(git, shas)
    return await extension(git, shas, await firstParentCommits(git, shas.reviewedSha, shas.headSha))
  } catch (error) {
    return substantive(shas, 'Git could not classify the push.', {
      problems: [`Git could not classify the push: ${firstLine(error)}`],
    })
  }
}
