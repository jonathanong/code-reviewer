import { DEFAULT_SINCE_DAYS } from '../outcomes/collect.mts'
import { readOutcomes } from '../outcomes/store.mts'
import type { RepoConfigs } from '../review/rules/config.mts'
import type { TrackerIo } from '../tracker/types.mts'
import type { IssuesConfig } from './config-parse.mts'
import { DAY_MS, fileIssues, type IssuesIo, type IssuesResult } from './file.mts'

export type IssuesValues = { 'dry-run'?: boolean | undefined; since?: string | undefined }

/** The `issues` key of the first machine file that sets one: owner files, then repository files, each by name. */
export function resolveIssues(configs: RepoConfigs): IssuesConfig | undefined {
  const layers = [configs.byOwner, configs.byRepo].flatMap((byName) =>
    [...byName.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, config]) => config),
  )
  return layers.find((config) => config.issues !== undefined)?.issues
}

/** Config problems about the `issues` key; every one names its file and says `issues`. */
export const issuesProblems = (configs: RepoConfigs) =>
  configs.problems.filter((problem) => /(^|[\s:])issues[\s.[:]/u.test(problem))

/**
 * `code-reviewer issues`: files an issue for each proposal from the stored outcomes whose target
 * the machine config names. Nothing else calls it.
 */
export async function issuesCommand(
  values: IssuesValues,
  configs: RepoConfigs,
  tracker: TrackerIo,
  io: IssuesIo,
): Promise<{ result: IssuesResult; messages: string[] }> {
  const bad = issuesProblems(configs)
  if (bad.length > 0) throw new Error(`invalid issues config: ${bad.join('; ')}`)
  const days = values.since === undefined ? DEFAULT_SINCE_DAYS : Number(values.since)
  if (!Number.isInteger(days) || days < 1) throw new Error('--since must be a positive integer.')
  const from = tracker.now().getTime() - days * DAY_MS
  const rows = readOutcomes(tracker).filter((row) => Date.parse(row.checkedAt) >= from)
  return fileIssues(
    { config: resolveIssues(configs), rows, dryRun: values['dry-run'] === true },
    tracker,
    io,
  )
}
