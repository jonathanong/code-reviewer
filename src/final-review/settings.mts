import type { RepoConfigs } from './rules/config.mts'
import type { CheckRunSettings, LabelNames } from './rules/settings-parse.mts'

export type { CheckRunSettings, LabelNames } from './rules/settings-parse.mts'

/** The label names a repository gets when neither its file nor its owner's file sets them. */
export const DEFAULT_LABELS: LabelNames = {
  /** Added by a requester (human or agent) to ask the standing reviewer for a review. */
  requested: 'final-review:requested',
  /** Set while a review runs, so a restart can find reviews it abandoned. */
  processing: 'final-review:in-progress',
  /** Set when the review is posted or skipped; the verdict lives in the review and approval. */
  completed: 'final-review:complete',
  /** Label a final approval carries; removed before any re-review. */
  approval: 'final approval',
}

export type ReviewSettings = {
  labels: LabelNames
  /** `null` when no check run is configured. */
  checkRun: CheckRunSettings | null
}

/**
 * Resolves settings for `owner/name`, or for `owner` alone: defaults, then the owner file, then the
 * repository file, per key.
 */
export function reviewSettings(configs: RepoConfigs, scope: string): ReviewSettings {
  const [owner = '', name] = scope.toLowerCase().split('/')
  const org = configs.byOwner.get(owner)
  const repo = name === undefined ? undefined : configs.byRepo.get(`${owner}/${name}`)
  return {
    labels: { ...DEFAULT_LABELS, ...org?.labels, ...repo?.labels },
    checkRun: repo?.checkRun ?? org?.checkRun ?? null,
  }
}

/** Problems found in the files that feed `owner`'s settings, for `settings` to print. */
export function settingsProblems(configs: RepoConfigs, owner: string): string[] {
  const prefix = owner.toLowerCase()
  return configs.problems.filter((problem) => {
    const lower = problem.toLowerCase()
    return lower.startsWith(`${prefix}.json`) || lower.startsWith(`${prefix}/`)
  })
}
