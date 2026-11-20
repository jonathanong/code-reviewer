import {
  reportCheckRun,
  repoSettings,
  type CheckRunResult,
  type CheckRunStep,
  type LabelNames,
  type PullTarget,
} from '../review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import type { ReviewDeps } from './deps.mts'

export async function labelsFor(deps: ReviewDeps, repo: string): Promise<LabelNames> {
  return (await repoSettings(deps, repo)).labels
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
