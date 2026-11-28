import { claimReplies, releaseReplies, resolveRun } from '../review/index.mts'
import { parseModelOverrides } from '../review/model-overrides.mts'
import { resolveModels } from '../review/models-settings.mts'
import { breakingChangeRule } from '../review/replies/judge.mts'
import { headMoved, newestOwnReview, planReplies } from '../review/replies/select.mts'
import { RUN_EXIT, type RunExit } from '../run/output.mts'
import { checkPreconditions, parseFlags, Precondition } from '../run/preflight.mts'
import { defaultRunEnv, type RunEnv } from '../run/command.mts'
import { line, type RepliesLine } from './command-replies-line.mts'
import { assessReplies } from './command-replies-run.mts'
import { withSinceDiffs } from './command-replies-since.mts'
import { message } from './command-replies-write.mts'
import type { ReviewDeps } from './deps.mts'
import { labelsFor } from './review-settings.mts'

export type RepliesValues = {
  repo?: string[] | undefined
  pr?: string | undefined
  post?: string | undefined
  model?: string[] | undefined
}

/**
 * `code-reviewer replies`: re-assesses this reviewer's newest review of a pull request from the
 * author's new replies on its unresolved threads, in one model call with no tools. Settled findings
 * leave the findings, lowered ones keep a lower severity, and the verdict is derived again; a
 * lower verdict goes out as a new review of the same head. When the head moved since that review,
 * a thread with a new author reply is judged against the new head with the diff since the reviewed
 * commit, and only the threads are answered or resolved: no review, verdict, approval or label
 * follows, because the new commits were not reviewed as a whole. A follow-up review is the only
 * path to a verdict on the new head.
 */
export async function repliesCommand(
  values: RepliesValues,
  deps: ReviewDeps,
  env: RunEnv = defaultRunEnv(),
): Promise<RepliesLine> {
  const { pull, post } = parseFlags(values)
  const base = { repo: pull.repo, pr: pull.pr }
  await checkPreconditions(deps, pull.repo)
  const io = deps.createIo(pull)
  const trusted = await io.trustedAuthors()
  if (trusted.size === 0) throw new Precondition('the reviewer identity is unknown.')
  const names = await labelsFor(deps, pull.repo)
  const labels = await deps.createLabelIo(pull).labels()
  const busy = [names.requested, names.processing, names.held].filter((name) =>
    labels.includes(name),
  )
  if (busy.length > 0) {
    return line({
      ...base,
      reason: `the pull request carries ${busy.join(', ')}; a review reads the replies itself`,
    })
  }
  const answers = deps.createAnswerIo(pull)
  const conversation = await answers.conversation(trusted)
  const planned = planReplies(conversation, trusted)
  if ('noop' in planned) return line({ ...base, reason: planned.noop })
  const plan = headMoved(planned) ? await withSinceDiffs(deps, pull.repo, planned, env) : planned
  if ('noop' in plan) return line({ ...base, headSha: planned.headSha, reason: plan.noop })
  const rule = breakingChangeRule(deps.references())
  if (rule === undefined) {
    throw new Precondition('the breaking-change rule is no longer in verifier.md.')
  }
  const models = resolveModels(deps.configs(), pull.repo, parseModelOverrides(values.model ?? []))
  const identity =
    deps.authMode() !== 'app' && resolveRun(deps.configs(), pull.repo).rules['not-app-identity']
      ? ['calls use the local gh login, not the GitHub App']
      : []
  const run = {
    deps,
    pull,
    plan,
    trusted,
    models: { plan: models.plan },
    rule,
    env,
    title: conversation.title,
    held: [...(post === 'hold' ? ['--post hold'] : []), ...identity],
  }
  // A held run writes nothing, so it takes no claim. A run that writes holds the in-progress label
  // until it is done, however it ends, so two runs, or a run and a review, do not write together.
  if (run.held.length > 0) return assessReplies(run)
  const labelIo = deps.createLabelIo(pull)
  // At a moved head the completion label is put back only if the pull request carried it, so the
  // labels end as they began: a run that gives no verdict on the new head does not mark it complete.
  const restoreCompleted = !headMoved(plan) || labels.includes(names.completed)
  const claim = await claimReplies(labelIo, names, {
    restoreCompleted,
    reviewedSince: async () =>
      newestOwnReview(await answers.conversation(trusted), trusted) !== plan.reviewId,
  })
  if (!claim.claimed) {
    return line({ ...base, headSha: plan.headSha, reason: `not claimed: ${claim.reason}` })
  }
  let result: RepliesLine
  try {
    result = await assessReplies(run)
  } catch (error) {
    await releaseReplies(labelIo, names, restoreCompleted).catch(() => undefined)
    throw error
  }
  const problem = await releaseReplies(labelIo, names, restoreCompleted).then(
    () => undefined,
    (error: unknown) => `could not release the claim: ${message(error)}`,
  )
  return problem === undefined ? result : { ...result, attention: [...result.attention, problem] }
}

/** Runs `repliesCommand`, prints its line, and turns a failure into an error line with an exit code. */
export async function runRepliesCommand(values: RepliesValues, deps: ReviewDeps): Promise<RunExit> {
  let result: RepliesLine
  try {
    result = await repliesCommand(values, deps)
  } catch (error) {
    const code = error instanceof Precondition ? RUN_EXIT.precondition : RUN_EXIT.failed
    result = line({ outcome: 'error', exitCode: code, reason: message(error) })
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result.exitCode
}
