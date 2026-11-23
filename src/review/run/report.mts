import type { Usage } from '../benchmark/usage.mts'
import type { ModelTotals } from '../benchmark/usage-summary.mts'
import type { Finding, SkippedPillar } from '../finding.mts'
import type { Question } from '../question.mts'
import type { Mode } from '../mode.mts'
import type { Verdict } from '../render.mts'
import type { CarriedFile } from '../carried-file.mts'
import type { Dependency } from '../dependency.mts'
import type { LinkedCommit } from '../context/types.mts'
import type { PushFile } from '../push-file.mts'
import type { StackFile } from '../stack-file.mts'
import type { ApprovalCheck } from './approval-check.mts'
import type { HeldEvidence } from './evidence-reuse.mts'
import type { EvidenceReport } from './evidence-types.mts'
import { reportPush, type ReportPush } from './push-report.mts'
import { reportRegression, type ReportRegression } from './regression-report.mts'
import { byStep, evidenceUsages } from './report-usage.mts'
import { reportAdvice, type ReportAdvice } from './report-advice.mts'
import { ranRows, type RanRow } from './report-models.mts'
import { markDropped } from './report-pillars.mts'
import { reportStack, type ReportStack } from './stack-report.mts'
import type { PillarResult, SkillChoice } from './types.mts'
import type { ReviewVerifierOutput } from './verify.mts'

/** A finding a pillar returned and whether the verifier kept it. */
export type ReportFinding = Finding & { dropped: boolean; droppedReason?: string }

export type ReportPillar = {
  pillar: PillarResult['pillar']
  model: string
  skills: string[]
  usage: Usage | null
  /** Set when the pillar never answered; its failed attempts still cost money. */
  error?: string
  failedAttempts: PillarResult['failedAttempts']
  findings: ReportFinding[]
}

/** Everything `report.md` shows, saved as `report.json` so the Markdown can be rendered again. */
export type ReportData = {
  version: 1
  repo: string
  pr: number
  title: string
  url: string
  headSha: string
  mode: Mode
  effort: string
  reasons: string[]
  /** Set for a skipped review: why nothing ran. */
  skipReason?: string
  pullRequestSummary: string // what the pull request does, from the verifier
  summary: string // the verifier's review summary
  /** Null for a skipped review, which has no findings to derive one from. */
  verdict: Verdict | null
  findings: Finding[]
  questions?: Question[] // absent in a report written before questions existed
  postWarnings?: string[] // text over a target or narrating the review; absent in an older report
  /** Threads of earlier findings that are now fixed, to resolve after posting. */
  fixedThreadIds: string[]
  pillars: ReportPillar[]
  skipped: SkippedPillar[]
  skillSelection: SkillChoice
  verifier: { model: string; usage: Usage | null } | null
  evidence?: EvidenceReport // absent when no evidence source is configured
  approvalCheck?: ApprovalCheck // absent unless a review that would approve got a second check
  stack?: ReportStack // absent for a pull request that is not in a stack
  push?: ReportPush // absent for a first review, or when the head did not move
  carried?: CarriedFile // absent when git found no commit already elsewhere and the base is fine
  dependencies?: Dependency[] // absent when the pull request depends on nothing
  contextNote?: string // why the pillars got no context file; absent when they got one
  /** Why a follow-up's verifier got no earlier review of this machine; absent when it got one or had none to look for. */
  earlierReviewNote?: string
  /** The earlier review's evidence offered to the verifier as still holding; absent when none was. */
  earlierEvidence?: Array<{ source: string; commit: string; status: string }>
  /** The commits the change says it fixes or reverts, and the verifier's one-line recommendation. */
  regression?: ReportRegression // absent without linked commits
  /** Tokens and cost per model for the whole review, by step: selection, pillars, verifier, evidence. */
  usageByModel: Array<{ name: string; models: ModelTotals[] }>
  /** The harness and model that ran each step; absent in a report written before steps recorded them. */
  ran?: RanRow[]
} & ReportAdvice

export type ReportInput = {
  repo: string
  pr: number
  title: string
  headSha: string
  mode: Mode
  effort: string
  reasons: string[]
  skipReason?: string
  verdict: Verdict | null
  postWarnings?: string[] | undefined
  skipped: SkippedPillar[]
  skillSelection: SkillChoice
  pillars: readonly PillarResult[]
  verifier?: { model: string; output: ReviewVerifierOutput } | undefined
  evidence?: EvidenceReport | undefined
  approvalCheck?: ApprovalCheck | undefined
  stack?: StackFile | undefined
  push?: PushFile | undefined
  carried?: CarriedFile | undefined
  dependencies?: readonly Dependency[] | undefined
  contextNote?: string | undefined
  earlierReviewNote?: string | undefined
  earlierEvidence?: readonly HeldEvidence[] | undefined
  regression?: readonly LinkedCommit[] | undefined
}

/** Raw findings in the order the verifier saw them, so `sources` and `dropped` index into them. */
export function flattenFindings(pillars: readonly PillarResult[]): Finding[] {
  return pillars.flatMap((result) => result.findings)
}

export function buildReport(input: ReportInput): ReportData {
  const output = input.verifier?.output
  const stack = reportStack(input.stack, output?.findings ?? [])
  const rows = ranRows({ ...input, verifier: output })
  return {
    version: 1,
    repo: input.repo,
    pr: input.pr,
    title: input.title,
    url: `https://github.com/${input.repo}/pull/${input.pr}`,
    headSha: input.headSha,
    mode: input.mode,
    effort: input.effort,
    reasons: input.reasons,
    ...(input.skipReason === undefined ? {} : { skipReason: input.skipReason }),
    pullRequestSummary: output?.pullRequestSummary ?? '',
    summary: output?.summary ?? '',
    verdict: input.verdict,
    findings: output?.findings ?? [],
    questions: output?.questions ?? [],
    postWarnings: input.postWarnings ?? [],
    fixedThreadIds: output?.fixedThreadIds ?? [],
    pillars: markDropped(input.pillars, output),
    skipped: input.skipped,
    skillSelection: input.skillSelection,
    ...(input.evidence === undefined ? {} : { evidence: input.evidence }),
    ...(input.approvalCheck === undefined ? {} : { approvalCheck: input.approvalCheck }),
    ...(stack === undefined ? {} : { stack }),
    ...(input.push === undefined ? {} : { push: reportPush(input.push) }),
    ...(input.carried === undefined ? {} : { carried: input.carried }),
    ...(input.dependencies === undefined || input.dependencies.length === 0
      ? {}
      : { dependencies: [...input.dependencies] }),
    ...(input.contextNote === undefined ? {} : { contextNote: input.contextNote }),
    ...(input.earlierReviewNote === undefined
      ? {}
      : { earlierReviewNote: input.earlierReviewNote }),
    ...(input.earlierEvidence === undefined
      ? {}
      : {
          earlierEvidence: input.earlierEvidence.map(({ source, commit, status }) => ({
            source,
            commit,
            status,
          })),
        }),
    ...reportRegression(input.regression, output?.regressionPrevent),
    ...reportAdvice(output),
    verifier:
      input.verifier === undefined
        ? null
        : { model: input.verifier.model, usage: input.verifier.output.usage },
    usageByModel: byStep(input),
    ...(rows.length === 0 ? {} : { ran: rows }),
  }
}

function spent(usage: Usage | null): number {
  return usage?.costUsd ?? 0
}

/** Cost of the skill selection, each pillar and the evidence run (failed attempts included), and the verifier. */
export function costBreakdown(data: ReportData) {
  const pillars = data.pillars.reduce(
    (sum, pillar) =>
      sum +
      spent(pillar.usage) +
      pillar.failedAttempts.reduce((inner, attempt) => inner + spent(attempt.usage), 0),
    0,
  )
  const selection = spent(data.skillSelection.usage)
  const verifier = spent(data.verifier?.usage ?? null)
  const evidence = evidenceUsages(data.evidence).reduce((sum, usage) => sum + spent(usage), 0)
  const approvalCheck = spent(data.approvalCheck?.usage ?? null)
  return {
    selection,
    pillars,
    verifier,
    evidence,
    approvalCheck,
    total: selection + pillars + verifier + evidence + approvalCheck,
  }
}
