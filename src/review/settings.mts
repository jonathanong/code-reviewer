import type { RepoConfig, RepoConfigs } from './rules/config.mts'
import type { TargetConfig } from './rules/target-config.mts'
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

/** Where a setting's value came from. */
export type SettingLayer = 'machine repo' | 'machine owner' | 'repository file' | 'default'

export type SettingLayers = {
  labels: Record<keyof LabelNames, SettingLayer>
  checkRun: SettingLayer | null
}

type Candidate = readonly [SettingLayer, RepoConfig | undefined]

/** Highest layer first: machine repo file, machine owner file, then the repository's own file. */
function candidates(
  configs: RepoConfigs,
  scope: string,
  target: RepoConfig | undefined,
): Candidate[] {
  const [owner = '', name] = scope.toLowerCase().split('/')
  return [
    ['machine repo', name === undefined ? undefined : configs.byRepo.get(`${owner}/${name}`)],
    ['machine owner', configs.byOwner.get(owner)],
    ['repository file', name === undefined ? undefined : target],
  ]
}

/**
 * Resolves settings for `owner/name`, or for `owner` alone, per key: the machine repo file, the
 * machine owner file, the repository's own file, then the defaults. Labels merge by name.
 */
export function reviewSettings(
  configs: RepoConfigs,
  scope: string,
  target?: RepoConfig,
): ReviewSettings {
  const layers = candidates(configs, scope, target)
  const labels = { ...DEFAULT_LABELS }
  for (const [, config] of layers.toReversed()) Object.assign(labels, config?.labels)
  return {
    labels,
    checkRun: layers.find(([, config]) => config?.checkRun !== undefined)?.[1]?.checkRun ?? null,
  }
}

/** The layer each setting of `reviewSettings` came from. */
export function settingLayers(
  configs: RepoConfigs,
  scope: string,
  target?: RepoConfig,
): SettingLayers {
  const layers = candidates(configs, scope, target)
  const labelLayer = (key: keyof LabelNames): SettingLayer =>
    layers.find(([, config]) => config?.labels?.[key] !== undefined)?.[0] ?? 'default'
  return {
    labels: {
      requested: labelLayer('requested'),
      processing: labelLayer('processing'),
      completed: labelLayer('completed'),
      approval: labelLayer('approval'),
    },
    checkRun: layers.find(([, config]) => config?.checkRun !== undefined)?.[0] ?? null,
  }
}

/** What `repoSettings` reads: the machine configs and, per repository, its own file. */
export type SettingsSource = {
  configs(): RepoConfigs
  targetConfig(repo: string): Promise<TargetConfig>
}

/** `reviewSettings` for one repository, including the file it keeps on its default branch. */
export async function repoSettings(source: SettingsSource, repo: string): Promise<ReviewSettings> {
  return reviewSettings(source.configs(), repo, (await source.targetConfig(repo)).config)
}

/** Problems found in the files that feed `owner`'s settings, for `settings` to print. */
export function settingsProblems(configs: RepoConfigs, owner: string): string[] {
  const prefix = owner.toLowerCase()
  return configs.problems.filter((problem) => {
    const lower = problem.toLowerCase()
    return lower.startsWith(`${prefix}.json`) || lower.startsWith(`${prefix}/`)
  })
}
