import { existsSync } from 'node:fs'
import { join } from 'node:path'

import {
  EFFORTS,
  assertPullTarget,
  reviewStatus,
  type LabelNames,
  type PullTarget,
} from '../review/index.mts'
import { parseModelOverrides } from '../review/models.mts'
import { parseMaxCost } from '../review/limits-settings.mts'
import { unloadableMessage, unloadableRulePlugins } from '../review/plugins.mts'
import { resolveRulePlugins } from '../review/settings.mts'
import { foldRows, readRows } from '../tracker/store.mts'
import type { ReviewDeps } from '../cli/deps.mts'
import { labelsFor } from '../cli/review-settings.mts'

/** A missing plugin, a bad setting, unresolvable auth or a bad flag: nothing was claimed or posted. */
export class Precondition extends Error {}

export type RunFlags = {
  pull: PullTarget
  post: 'auto' | 'hold'
  force: boolean
}

type FlagValues = {
  repo?: string[] | undefined
  pr?: string | undefined
  post?: string | undefined
  effort?: string | undefined
  force?: boolean | undefined
  model?: string[] | undefined
  'max-cost'?: string | undefined
}

/** Validates the flags before anything is read or written. */
export function parseFlags(values: FlagValues): RunFlags {
  const repo = values.repo?.[0]
  if (repo === undefined || values.pr === undefined) {
    throw new Precondition('--repo and --pr are required.')
  }
  const pull = { repo, pr: Number(values.pr) }
  try {
    assertPullTarget(pull)
  } catch (error) {
    throw new Precondition((error as Error).message, { cause: error })
  }
  const post = values.post ?? 'auto'
  if (post !== 'auto' && post !== 'hold') throw new Precondition('--post must be auto or hold.')
  if (values.effort !== undefined && !EFFORTS.some((effort) => effort === values.effort)) {
    throw new Precondition(`--effort must be one of ${EFFORTS.join(', ')}.`)
  }
  try {
    parseModelOverrides(values.model ?? [])
    parseMaxCost(values['max-cost'])
  } catch (error) {
    throw new Precondition((error as Error).message, { cause: error })
  }
  return { pull, post, force: values.force === true }
}

/** Config problems that name this repository's or its owner's machine files, in lowercase compare. */
function configProblems(deps: ReviewDeps, repo: string): string[] {
  const lower = repo.toLowerCase()
  const owner = lower.split('/')[0] as string
  return deps.configs().problems.filter((problem) => {
    const text = problem.toLowerCase()
    return text.startsWith(`${owner}.`) || text.startsWith(`${lower}.`)
  })
}

/**
 * Fails fast, before any claim: the machine config and the repository's own file have no
 * problems, every configured rule plugin is enabled at user scope (where a headless run loads it),
 * and auth resolves (under the App, its own login too).
 */
export async function checkPreconditions(deps: ReviewDeps, repo: string): Promise<void> {
  const failure = async (): Promise<string | undefined> => {
    const problems = [...configProblems(deps, repo), ...(await deps.targetConfig(repo)).problems]
    if (problems.length > 0) return `settings invalid: ${problems.join('; ')}`
    const { installs } = await deps.pluginInfo()
    const { names } = resolveRulePlugins(deps.configs(), repo)
    const missing = unloadableRulePlugins(installs, names)
    if (missing.length > 0) return unloadableMessage(missing)
    const { loginError } = await deps.authIdentity()
    return loginError
  }
  let reason: string | undefined
  try {
    reason = await failure()
  } catch (error) {
    reason = error instanceof Error ? error.message : String(error)
  }
  if (reason !== undefined) throw new Precondition(reason)
}

/** The run directory of an unposted review of this head, left by a held run or a manual `review`. */
function unposted(deps: ReviewDeps, pull: PullTarget, headSha: string): string | undefined {
  const row = foldRows(readRows(deps.tracker()).rows).find(
    (candidate) =>
      candidate.repo.toLowerCase() === pull.repo.toLowerCase() &&
      candidate.pr === pull.pr &&
      candidate.head === headSha &&
      candidate.state === 'reviewed',
  )
  const dir = row?.runDir
  return dir !== null && dir !== undefined && existsSync(join(dir, 'review.json')) ? dir : undefined
}

export type Preflight =
  | { noop: string; headSha: string }
  | { noop?: undefined; headSha: string; names: LabelNames; labels: string[] }

/**
 * Reads only: whether another session already holds the pull request or a review already covers
 * its head. A held or unposted review of this head is not reviewed again, which also keeps the
 * request label a hold puts back from starting a loop.
 */
export async function preflight(
  deps: ReviewDeps,
  pull: PullTarget,
  force: boolean,
): Promise<Preflight> {
  const names = await labelsFor(deps, pull.repo)
  const [status, labels] = await Promise.all([
    reviewStatus(deps.createIo(pull)),
    deps.createLabelIo(pull).labels(),
  ])
  const { headSha } = status
  if (force) return { headSha, names, labels }
  if (status.current) {
    return { headSha, noop: `head already reviewed (verdict ${String(status.verdict)})` }
  }
  if (labels.includes(names.processing)) return { headSha, noop: 'already in progress' }
  const waiting = unposted(deps, pull, headSha)
  if (waiting !== undefined) {
    return { headSha, noop: `an unposted review of this head waits in ${waiting}` }
  }
  return { headSha, names, labels }
}
