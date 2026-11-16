import {
  reportCheckRun,
  reviewSettings,
  type CheckRunResult,
  type CheckRunStep,
  type LabelNames,
  type PullTarget,
} from '../final-review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import type { FinalReviewDeps } from './deps.mts'

export function labelsFor(deps: FinalReviewDeps, repo: string): LabelNames {
  return reviewSettings(deps.configs(), repo).labels
}

/** Writes the check run `step` for the pull request's repository, if one is configured. */
export function checkRunFor(
  deps: FinalReviewDeps,
  target: PullTarget,
  step: CheckRunStep,
): Promise<CheckRunResult | undefined> {
  const { owner, name } = splitRepo(target.repo)
  return reportCheckRun({
    settings: reviewSettings(deps.configs(), target.repo),
    mode: deps.authMode(),
    run: deps.runner(owner, name),
    repo: target.repo,
    headSha: () => deps.createIo(target).headSha(),
    step,
  })
}
