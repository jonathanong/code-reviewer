import type { Usage } from '../benchmark/usage.mts'
import { summarizeModels, type ModelTotals } from '../benchmark/usage-summary.mts'
import type { Finding, SkippedPillar } from '../finding.mts'
import type { Question } from '../question.mts'
import type { Mode } from '../mode.mts'
import type { Verdict } from '../render.mts'
import type { CarriedFile } from '../carried-file.mts'
import type { Dependency } from '../dependency.mts'
import type { PushFile } from '../push-file.mts'
import type { StackFile } from '../stack-file.mts'
import type { ApprovalCheck } from './approval-check.mts'
import type { EvidenceReport } from './evidence-types.mts'
import { reportPush, type ReportPush } from './push-report.mts'
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
  /** Tokens and cost per model for the whole review, by step: selection, pillars, verifier, evidence. */
  usageByModel: Array<{ name: string; models: ModelTotals[] }>
}

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
}

/** Raw findings in the order the verifier saw them, so `sources` and `dropped` index into them. */
export function flattenFindings(pillars: readonly PillarResult[]): Finding[] {
  return pillars.flatMap((result) => result.findings)
}

function present(usages: ReadonlyArray<Usage | null>): Usage[] {
  return usages.filter((usage): usage is Usage => usage !== null)
}

function evidenceUsages(evidence: EvidenceReport | undefined): Array<Usage | null> {
  return evidence === undefined
    ? []
    : [evidence.usage, ...evidence.failedAttempts.map((attempt) => attempt.usage)]
}

function byStep(input: ReportInput) {
  const pillars = input.pillars.flatMap((pillar) => [
    pillar.usage,
    ...pillar.failedAttempts.map((attempt) => attempt.usage),
  ])
  return [
    { name: 'selection', models: summarizeModels(present([input.skillSelection.usage])) },
    { name: 'pillars', models: summarizeModels(present(pillars)) },
    { name: 'verifier', models: summarizeModels(present([input.verifier?.output.usage ?? null])) },
    ...(input.evidence === undefined
      ? []
      : [{ name: 'evidence', models: summarizeModels(present(evidenceUsages(input.evidence))) }]),
    ...(input.approvalCheck === undefined
      ? []
      : [
          { name: 'approval check', models: summarizeModels(present([input.approvalCheck.usage])) },
        ]),
  ]
}

export function buildReport(input: ReportInput): ReportData {
  const output = input.verifier?.output
  const stack = reportStack(input.stack, output?.findings ?? [])
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
    verifier:
      input.verifier === undefined
        ? null
        : { model: input.verifier.model, usage: input.verifier.output.usage },
    usageByModel: byStep(input),
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
