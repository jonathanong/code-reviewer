import {
  EFFORTS,
  STARTED,
  abortReview,
  abortedStep,
  assertOwner,
  assertRepo,
  claimReview,
  reviewStatus,
  prepareReview,
  resolveEvidence,
  resolveThreads,
  reviewSettings,
  settingLayers,
  settingsProblems,
  skipPullRequest,
  skippedStep,
  type Effort,
  type PullTarget,
} from '../review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import type { ReviewDeps } from './deps.mts'
import { listQueueFor } from './queue.mts'
import { checkRunFor, labelsFor } from './review-settings.mts'

export type LoopValues = {
  owner?: string | undefined
  repo?: string[] | undefined
  force?: boolean | undefined
  requeue?: boolean | undefined
  reason?: string | undefined
  out?: string | undefined
  effort?: string | undefined
  tree?: string | undefined
  clones?: string | undefined
  thread?: string[] | undefined
}

function effort(value: string | undefined): Effort | undefined {
  if (value === undefined) return undefined
  const found = EFFORTS.find((candidate) => candidate === value)
  if (found === undefined) throw new Error(`--effort must be one of ${EFFORTS.join(', ')}.`)
  return found
}

/**
 * The resolved labels and check run for one repository or owner, the layer each came from, and
 * problems in the files that fed them.
 */
async function settings(values: LoopValues, deps: ReviewDeps) {
  const repo = values.repo?.[0]
  if ((repo === undefined) === (values.owner === undefined)) {
    throw new Error('settings needs --repo or --owner.')
  }
  const scope = repo ?? (values.owner as string)
  if (repo === undefined) assertOwner(scope)
  else assertRepo(repo)
  const configs = deps.configs()
  const target = repo === undefined ? undefined : await deps.targetConfig(repo)
  const evidence = resolveEvidence(configs, scope)
  return {
    scope,
    ...reviewSettings(configs, scope, target?.config),
    from: settingLayers(configs, scope, target?.config),
    // Names only: a source's env values and commands stay out of any output.
    evidence: { sources: evidence.sources.map((source) => source.name), from: evidence.from },
    problems: [
      ...settingsProblems(configs, scope.split('/')[0] as string),
      ...(target?.problems ?? []),
    ],
  }
}

/** Takes a requested review; the outcome says whether it was claimed. */
export async function claimCommand(values: LoopValues, target: () => PullTarget, deps: ReviewDeps) {
  const force = values.force === true
  const status = force ? undefined : await reviewStatus(deps.createIo(target()))
  const outcome = await claimReview(
    deps.createLabelIo(target()),
    await labelsFor(deps, target().repo),
    {
      force,
      headReviewed: status?.current === true,
    },
  )
  if (!outcome.claimed) return status === undefined ? outcome : { ...outcome, status }
  return { ...outcome, checkRun: await checkRunFor(deps, target(), STARTED, status?.headSha) }
}

/** Drops the in-progress label; `--requeue` asks again. */
export async function abortCommand(values: LoopValues, target: () => PullTarget, deps: ReviewDeps) {
  const labels = await abortReview(
    deps.createLabelIo(target()),
    await labelsFor(deps, target().repo),
    {
      requeue: values.requeue === true,
    },
  )
  return { ...labels, checkRun: await checkRunFor(deps, target(), abortedStep()) }
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
      return { mode: deps.authMode(), ...(await deps.authIdentity()) }
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
