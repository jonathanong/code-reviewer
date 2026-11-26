import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { ReviewInput } from '../review/finding.mts'
import { isDependabot } from '../review/author-rules.mts'
import { APPROVAL_CHECK } from '../review/skipped.mts'
import { readStackFile } from '../review/stack-file.mts'
import { isDependencyFile, reviewableLines, type ChangedFile } from '../review/triggers.mts'
import { riskyPaths } from './risky.mts'
import type { ReportData } from '../review/run/report.mts'

/** What the finished run's files say about how far to trust the review. */
export type RunFacts = {
  questions: number
  /** The kind of each flag the review raised. */
  flags: string[]
  partial: string[]
  truncated: string[]
  author: string | null
  tokens: { input: number; output: number }
}

function json<T>(out: string, name: string): T {
  return JSON.parse(readFileSync(join(out, name), 'utf8')) as T
}

/** Failures that did not stop the review but mean part of it never ran. */
function partialFailures(report: ReportData): string[] {
  const pillars = report.pillars
    .filter((pillar) => pillar.error !== undefined)
    .map((pillar) => `pillar ${pillar.pillar} failed`)
  const evidence = report.evidence
  const sources = (evidence?.sources ?? [])
    .filter((source) => source.status === 'blocked')
    .map((source) => `evidence source ${source.name} blocked`)
  return [
    ...pillars,
    ...(evidence?.error === undefined ? [] : ['evidence run failed']),
    ...sources,
    ...(report.verifier === null ? ['verifier did not run'] : []),
    ...(report.skipped.some((entry) => entry.pillar === APPROVAL_CHECK)
      ? ['the approval was not double-checked']
      : []),
  ]
}

/** Reads `review.json`, `report.json`, `context.json` and `stack.json` from the run directory. */
export function runFacts(out: string): RunFacts {
  const review = json<ReviewInput>(out, 'review.json')
  const report = json<ReportData>(out, 'report.json')
  const context = json<{
    unread?: { threads: number; ownReview: boolean }
    author?: string | null
  }>(out, 'context.json')
  const skipped = (readStackFile(out)?.members ?? []).filter(
    (member) => member.diffSkipped !== undefined,
  )
  const totals = report.usageByModel.flatMap((step) => step.models)
  return {
    questions: review.questions.length,
    flags: (review.flags ?? []).map((flag) => flag.kind),
    partial: partialFailures(report),
    truncated: [
      ...(context.unread !== undefined && context.unread.threads > 0
        ? [`${context.unread.threads} older review threads were not read`]
        : []),
      ...(context.unread?.ownReview === true
        ? ["this reviewer's earlier review was not among the reviews read"]
        : []),
      ...skipped.map((member) => `diff of stack member #${member.number} was skipped`),
    ],
    author: context.author ?? null,
    tokens: {
      input: totals.reduce((sum, model) => sum + model.inputTokens, 0),
      output: totals.reduce((sum, model) => sum + model.outputTokens, 0),
    },
  }
}

/**
 * The size of the change (`files` counts files with changed lines, so a pure rename does not; a binary or
 * mode-only change also reports 0 lines) and the paths a human should read the review for (see `riskyPaths`). A Dependabot
 * pull request edits manifests and workflows by design, so those paths do not count for it; GraphQL
 * reports its login without the `[bot]` suffix, which is why the author is taken as a bot here.
 */
export function changeFacts(
  files: readonly ChangedFile[],
  author: string | null,
  riskyPatterns?: readonly string[],
) {
  const hits = riskyPaths(
    files.map((file) => file.path),
    riskyPatterns,
  )
  return {
    files: files.filter((file) => file.lines > 0).length,
    lines: reviewableLines(files),
    riskyPaths: isDependabot(author, true) ? hits.filter((p) => !isDependencyFile(p)) : hits,
  }
}
