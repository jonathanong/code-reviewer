import {
  STARTED,
  abortReview,
  abortedStep,
  claimReview,
  heldStep,
  reviewStatus,
  prepareReview,
  resolveThreads,
  skipPullRequest,
  skippedStep,
  type PullTarget,
} from '../review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import { earlierFor } from './prepare-earlier.mts'
import { requireValidConfig } from './config-check.mts'
import { authCommand } from './command-auth.mts'
import type { ReviewDeps } from './deps.mts'
import { listQueueFor } from './queue.mts'
import { settings } from './command-settings.mts'
import { checkRunFor, effort, labelsFor, prepareSettingsFor } from './review-settings.mts'

export type LoopValues = {
  owner?: string | undefined
  repo?: string[] | undefined
  force?: boolean | undefined
  requeue?: boolean | undefined
  /** Internal to `run`: release the claim as a hold for a person. */
  hold?: boolean | undefined
  /** Internal to `run`: the head the claim covers, so the check run is never written on a moved head. */
  headSha?: string | undefined
  /** Why `skip` skips, or why `abort` drops or holds a review; the check run says it. */
  reason?: string | undefined
  out?: string | undefined
  effort?: string | undefined
  tree?: string | undefined
  clones?: string | undefined
  thread?: string[] | undefined
}

const pullUrl = (target: PullTarget) => `https://github.com/${target.repo}/pull/${target.pr}`

/** Takes a requested review; the outcome says whether it was claimed. */
export async function claimCommand(values: LoopValues, target: () => PullTarget, deps: ReviewDeps) {
  await requireValidConfig(deps, target().repo)
  const force = values.force === true
  const status = force ? undefined : await reviewStatus(deps.createIo(target()))
  const outcome = await claimReview(
    deps.createLabelIo(target()),
    await labelsFor(deps, target().repo),
    {
      force,
      headReviewed: status?.current === true,
      headSha: values.headSha ?? status?.headSha,
      // A first claim of a head nothing covered yet backs off when a review of it appeared since.
      ...(force || status?.current === true
        ? {}
        : {
            reviewedSince: async () =>
              (await reviewStatus(deps.createIo(target()))).current === true,
          }),
    },
  )
  if (!outcome.claimed) return status === undefined ? outcome : { ...outcome, status }
  return {
    ...outcome,
    checkRun: await checkRunFor(deps, target(), STARTED, values.headSha ?? status?.headSha),
  }
}

/** Drops the in-progress label; `--requeue` asks again, and `run` holds a review for a person. */
export async function abortCommand(values: LoopValues, target: () => PullTarget, deps: ReviewDeps) {
  await requireValidConfig(deps, target().repo)
  const labels = await abortReview(
    deps.createLabelIo(target()),
    await labelsFor(deps, target().repo),
    {
      requeue: values.requeue === true,
      ...(values.hold === true ? { hold: true } : {}),
    },
  )
  const step =
    values.hold === true
      ? heldStep(values.reason ?? 'a person must post it', pullUrl(target()))
      : abortedStep(values.reason)
  return { ...labels, checkRun: await checkRunFor(deps, target(), step, values.headSha) }
}

/**
 * Closes a pull request the plan will not review: posts a skip review on the head (which `status`
 * accepts), then swaps the labels. `expectedHead` is the head the caller prepared.
 */
export async function skipCommand(
  values: LoopValues,
  target: () => PullTarget,
  deps: ReviewDeps,
  expectedHead?: string,
) {
  if (values.reason === undefined || values.reason.trim() === '') {
    throw new Error('skip needs --reason.')
  }
  await requireValidConfig(deps, target().repo)
  const { headSha, url, ...labels } = await skipPullRequest(
    deps.createIo(target()),
    deps.createLabelIo(target()),
    await labelsFor(deps, target().repo),
    values.reason,
    expectedHead,
  )
  const checkRun = await checkRunFor(deps, target(), skippedStep(values.reason, url), headSha)
  return { skipped: true, reason: values.reason, review: url, ...labels, checkRun }
}

/** Gathers the diff, context, plan and rule sources into `--out`. */
export async function prepareCommand(
  values: LoopValues,
  target: () => PullTarget,
  deps: ReviewDeps,
) {
  if (values.out === undefined) throw new Error('prepare needs --out.')
  const requested = effort(values.effort)
  return prepareReview(deps.createPrepareIo(target()), {
    out: values.out,
    earlier: earlierFor(deps, target, values.out),
    ...(await prepareSettingsFor(deps, target().repo)),
    ...(requested === undefined ? {} : { requested }),
    ...(values.tree === undefined ? {} : { tree: values.tree }),
    ...(values.clones === undefined ? {} : { clones: values.clones }),
  })
}

/** The standing-loop subcommands; returns undefined for any other subcommand. */
export async function runLoopCommand(
  subcommand: string,
  values: LoopValues,
  target: () => PullTarget,
  deps: ReviewDeps,
): Promise<unknown> {
  switch (subcommand) {
    case 'auth':
      return authCommand(values, deps)
    case 'settings':
      return settings(values, deps)
    case 'queue':
      return listQueueFor(deps, values.owner, values.repo ?? [])
    case 'claim':
      return claimCommand(values, target, deps)
    case 'abort':
      return abortCommand(values, target, deps)
    case 'skip':
      return skipCommand(values, target, deps)
    case 'prepare':
      return prepareCommand(values, target, deps)
    case 'resolve': {
      const { owner, name } = splitRepo(target().repo)
      return { resolved: await resolveThreads(deps.runner(owner, name), values.thread ?? []) }
    }
    default:
      return undefined
  }
}
