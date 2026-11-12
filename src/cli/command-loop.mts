import {
  EFFORTS,
  abortReview,
  claimReview,
  finalReviewStatus,
  listQueue,
  prepareReview,
  resolveThreads,
  type Effort,
  type PullTarget,
} from '../final-review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import type { FinalReviewDeps } from './deps.mts'

export type LoopValues = {
  owner?: string | undefined
  repo?: string[] | undefined
  force?: boolean | undefined
  requeue?: boolean | undefined
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
    case 'queue': {
      const repos = values.repo ?? []
      if (repos.length === 0) {
        if (values.owner === undefined || values.owner === '') {
          throw new Error('queue needs --owner or --repo.')
        }
        return listQueue(deps.runner(values.owner), values.owner)
      }
      // Each owner has its own installation, so list per owner with that owner's token.
      const byOwner = new Map<string, string[]>()
      for (const repo of repos) {
        const { owner } = splitRepo(repo)
        byOwner.set(owner, [...(byOwner.get(owner) ?? []), repo])
      }
      const entries = await Promise.all(
        [...byOwner].map(([owner, group]) => {
          const only = group.length === 1 ? splitRepo(group[0] as string).name : undefined
          return listQueue(deps.runner(owner, only), owner, group)
        }),
      )
      return entries.flat()
    }
    case 'claim': {
      const force = values.force === true
      const status = force ? undefined : await finalReviewStatus(deps.createIo(target()))
      const outcome = await claimReview(deps.createLabelIo(target()), {
        force,
        headReviewed: status?.current === true,
      })
      return status === undefined || outcome.claimed ? outcome : { ...outcome, status }
    }
    case 'abort':
      return abortReview(deps.createLabelIo(target()), { requeue: values.requeue === true })
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
