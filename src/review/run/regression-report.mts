import type { LinkedCommit } from '../context/types.mts'
import { regressionSection } from '../render.mts'

/** The commits a change says it fixes or reverts, and the verifier's one-line recommendation. */
export type ReportRegression = { commits: LinkedCommit[]; prevent?: string }

/** The `regression` field of `report.json`; absent without linked commits. */
export function reportRegression(
  commits: readonly LinkedCommit[] | undefined,
  prevent: string | undefined,
): { regression?: ReportRegression } {
  if (commits === undefined || commits.length === 0) return {}
  return { regression: { commits: [...commits], ...(prevent === undefined ? {} : { prevent }) } }
}

/** The report section: the linked commits, then the collapsed recommendation, if any. */
export function renderRegression(regression: ReportRegression | undefined): string[] {
  if (regression === undefined) return []
  const commits = regression.commits
    .map(
      (commit) => `- \`${commit.sha.slice(0, 7)}\` ${commit.subject.slice(0, 100)} (${commit.how})`,
    )
    .join('\n')
  return [
    `### Regression this change says it fixes\n\n${commits}`,
    ...regressionSection(regression.prevent),
  ]
}
