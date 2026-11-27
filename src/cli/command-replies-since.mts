import { resolve } from 'node:path'

import type { NoPlan, ReplyCandidate, ReplyPlan } from '../review/replies/select.mts'
import type { RunEnv } from '../run/command.mts'
import { checkoutHead } from '../run/tree.mts'
import { message } from './command-replies-write.mts'
import type { ReviewDeps } from './deps.mts'

/** The most of one file's diff the judging call reads. */
export const SINCE_DIFF_CHARS = 8000

const UNCHANGED = '(this file has no change since the reviewed commit)'

/**
 * For a head that moved since the review: gives each candidate the diff of its file from the
 * reviewed commit to the current head, read with local git on the head checked out the way `run`
 * checks it out. A candidate whose diff cannot be read is not judged (`unjudged`), since a reply that
 * says "fixed" cannot be checked without it. Returns a reason when no candidate is left.
 */
export async function withSinceDiffs(
  deps: ReviewDeps,
  repo: string,
  plan: ReplyPlan,
  env: RunEnv,
): Promise<ReplyPlan | NoPlan> {
  const root = env.env.CODE_REVIEWER_CLONE_ROOT
  let tree
  try {
    tree = await checkoutHead({
      repo,
      headSha: plan.headSha,
      clones: root === undefined ? undefined : resolve(root),
      git: env.git,
      tmp: env.tmp,
      remote: env.remote,
    })
  } catch (error) {
    return { noop: `the changes since the reviewed commit could not be read: ${message(error)}` }
  }
  const candidates: ReplyCandidate[] = []
  const unjudged = [...plan.unjudged]
  try {
    await env.git(['-C', tree.path, 'fetch', '--quiet', 'origin', plan.reviewedSha])
    for (const candidate of plan.candidates) {
      if (candidate.path === null) {
        unjudged.push({ thread: candidate.thread, why: 'the finding has no file to diff' })
        continue
      }
      const diff = await env.git([
        '-C',
        tree.path,
        'diff',
        '--no-color',
        plan.reviewedSha,
        plan.headSha,
        '--',
        candidate.path,
      ])
      const text = diff.trim() === '' ? UNCHANGED : diff
      candidates.push({
        ...candidate,
        sinceDiff:
          text.length > SINCE_DIFF_CHARS ? `${text.slice(0, SINCE_DIFF_CHARS)}\n[cut]` : text,
      })
    }
  } catch (error) {
    return { noop: `the changes since the reviewed commit could not be read: ${message(error)}` }
  } finally {
    await tree.remove().catch(() => undefined)
  }
  if (candidates.length === 0)
    return { noop: 'no thread with a new reply could be read against the new head' }
  return { ...plan, candidates, unjudged }
}
