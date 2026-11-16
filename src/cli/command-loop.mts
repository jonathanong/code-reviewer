import {
  EFFORTS,
  STARTED,
  abortReview,
  abortedStep,
  assertOwner,
  assertRepo,
  claimReview,
  finalReviewStatus,
  listQueue,
  prepareReview,
  resolveThreads,
  reviewSettings,
  settingsProblems,
  skipReview,
  skippedStep,
  type Effort,
  type LabelNames,
  type PullTarget,
} from '../final-review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import type { FinalReviewDeps } from './deps.mts'
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

/** The resolved labels and check run for one repository or owner, with problems in its files. */
function settings(values: LoopValues, deps: FinalReviewDeps) {
  const repo = values.repo?.[0]
  if ((repo === undefined) === (values.owner === undefined)) {
    throw new Error('settings needs --repo or --owner.')
  }
  const scope = repo ?? (values.owner as string)
  if (repo === undefined) assertOwner(scope)
  else assertRepo(repo)
  const configs = deps.configs()
  return {
    scope,
    ...reviewSettings(configs, scope),
    problems: settingsProblems(configs, scope.split('/')[0] as string),
  }
}

/** The standing-loop subcommands; returns undefined for any other subcommand. */
export async function runLoopCommand(
  subcommand: string,
  values: LoopValues,
  target: () => PullTarget,
  deps: FinalReviewDeps,
): Promise<unknown> {
  switch (subcommand) {
    case 'auth':
      return { mode: deps.authMode() }
    case 'settings':
      return settings(values, deps)
    case 'queue': {
      const repos = values.repo ?? []
      if (repos.length === 0) {
        if (values.owner === undefined || values.owner === '') {
          throw new Error('queue needs --owner or --repo.')
        }
        return listQueue(deps.runner(values.owner), values.owner, [], labelsFor(deps, values.owner))
      }
      // Each owner has its own installation, so list per owner with that owner's token, and per
      // label set because the search names the labels.
      const groups = new Map<string, { owner: string; labels: LabelNames; repos: string[] }>()
      for (const repo of repos) {
        const { owner } = splitRepo(repo)
        const labels = labelsFor(deps, repo)
        const key = JSON.stringify([owner, labels.requested, labels.processing])
        const group = groups.get(key) ?? { owner, labels, repos: [] }
        groups.set(key, { ...group, repos: [...group.repos, repo] })
      }
      const entries = await Promise.all(
        [...groups.values()].map(({ owner, labels, repos: group }) => {
          const only = group.length === 1 ? splitRepo(group[0] as string).name : undefined
          return listQueue(deps.runner(owner, only), owner, group, labels)
        }),
      )
      return entries.flat()
    }
    case 'claim': {
      const force = values.force === true
      const status = force ? undefined : await finalReviewStatus(deps.createIo(target()))
      const outcome = await claimReview(
        deps.createLabelIo(target()),
        labelsFor(deps, target().repo),
        {
          force,
          headReviewed: status?.current === true,
        },
      )
      if (!outcome.claimed) return status === undefined ? outcome : { ...outcome, status }
      return { ...outcome, checkRun: await checkRunFor(deps, target(), STARTED) }
    }
    case 'abort': {
      const labels = await abortReview(
        deps.createLabelIo(target()),
        labelsFor(deps, target().repo),
        {
          requeue: values.requeue === true,
        },
      )
      return { ...labels, checkRun: await checkRunFor(deps, target(), abortedStep()) }
    }
    case 'skip': {
      if (values.reason === undefined || values.reason.trim() === '') {
        throw new Error('skip needs --reason.')
      }
      const labels = await skipReview(deps.createLabelIo(target()), labelsFor(deps, target().repo))
      const checkRun = await checkRunFor(deps, target(), skippedStep(values.reason))
      return { skipped: true, reason: values.reason, ...labels, checkRun }
    }
    case 'prepare': {
      if (values.out === undefined) throw new Error('prepare needs --out.')
      const requested = effort(values.effort)
      return prepareReview(deps.createPrepareIo(target()), {
        out: values.out,
        ...(requested === undefined ? {} : { requested }),
        ...(values.tree === undefined ? {} : { tree: values.tree }),
        ...(values.clones === undefined ? {} : { clones: values.clones }),
      })
    }
    case 'resolve': {
      const { owner, name } = splitRepo(target().repo)
      return { resolved: await resolveThreads(deps.runner(owner, name), values.thread ?? []) }
    }
    default:
      return undefined
  }
}
