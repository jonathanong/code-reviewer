import {
  EFFORTS,
  abortReview,
  claimReview,
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
      const owner = values.owner ?? splitRepo(repos[0] ?? '').owner
      if (owner === '') throw new Error('queue needs --owner or --repo.')
      return listQueue(deps.runner(owner), owner, repos)
    }
    case 'claim':
      return claimReview(deps.createLabelIo(target()), { force: values.force === true })
    case 'abort':
      return abortReview(deps.createLabelIo(target()), { requeue: values.requeue === true })
    case 'prepare': {
      if (values.out === undefined) throw new Error('prepare needs --out.')
      const requested = effort(values.effort)
      return prepareReview(deps.createPrepareIo(target()), {
        out: values.out,
        ...(requested === undefined ? {} : { requested }),
        ...(values.tree === undefined ? {} : { tree: values.tree }),
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
