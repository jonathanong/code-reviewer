import {
  EFFORTS,
  reportCheckRun,
  repoSettings,
  type CheckRunResult,
  type CheckRunStep,
  type Effort,
  type LabelNames,
  type PullTarget,
} from '../review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import { requirePillars, type PillarSettings } from '../review/pillars-settings.mts'
import { resolvePlanValues, type PlanValues } from '../review/plan-settings.mts'
import type { ReviewDeps } from './deps.mts'

export async function labelsFor(deps: ReviewDeps, repo: string): Promise<LabelNames> {
  return (await repoSettings(deps, repo)).labels
}

/** Parses `--effort`; undefined when not given. */
export function effort(value: string | undefined): Effort | undefined {
  if (value === undefined) return undefined
  const found = EFFORTS.find((candidate) => candidate === value)
  if (found === undefined) throw new Error(`--effort must be one of ${EFFORTS.join(', ')}.`)
  return found
}

/** What `prepare` reads from the config: the pillars and the plan values, from one read of the repository's file. */
export async function prepareSettingsFor(
  deps: ReviewDeps,
  repo: string,
): Promise<{ pillars: PillarSettings; values: PlanValues }> {
  const own = (await deps.targetConfig(repo)).config
  return {
    pillars: requirePillars(deps.configs(), repo, own),
    values: resolvePlanValues(deps.configs(), repo, own),
  }
}

/**
 * Writes the check run `step` for the pull request's repository, if one is configured, on `headSha`
 * when the caller already holds the head it reviewed; otherwise on the head read once now.
 */
export async function checkRunFor(
  deps: ReviewDeps,
  target: PullTarget,
  step: CheckRunStep,
  headSha?: string,
): Promise<CheckRunResult | undefined> {
  const { owner, name } = splitRepo(target.repo)
  return await reportCheckRun({
    settings: await repoSettings(deps, target.repo),
    mode: deps.authMode(),
    run: deps.runner(owner, name),
    repo: target.repo,
    headSha: () =>
      headSha === undefined ? deps.createIo(target).headSha() : Promise.resolve(headSha),
    step,
  })
}
