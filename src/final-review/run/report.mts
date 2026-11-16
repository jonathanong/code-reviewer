import type { Usage } from '../benchmark/usage.mts'
import type { Finding, SkippedPillar } from '../finding.mts'
import type { Mode } from '../mode.mts'
import type { Verdict } from '../render.mts'
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
  /** What the pull request does, from the verifier. */
  pullRequestSummary: string
  /** The verifier's review summary. */
  summary: string
  /** Null for a skipped review, which has no findings to derive one from. */
  verdict: Verdict | null
  findings: Finding[]
  pillars: ReportPillar[]
  skipped: SkippedPillar[]
  skillSelection: SkillChoice
  verifier: { model: string; usage: Usage | null } | null
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
  skipped: SkippedPillar[]
  skillSelection: SkillChoice
  pillars: readonly PillarResult[]
  verifier?: { model: string; output: ReviewVerifierOutput } | undefined
}

/** Raw findings in the order the verifier saw them, so `sources` and `dropped` index into them. */
export function flattenFindings(pillars: readonly PillarResult[]): Finding[] {
  return pillars.flatMap((result) => result.findings)
}

function markDropped(
  pillars: readonly PillarResult[],
  output: ReviewVerifierOutput | undefined,
): ReportPillar[] {
  const kept = new Set(output?.sources.flat() ?? [])
  return pillars.map((result, position) => {
    const start = pillars
      .slice(0, position)
      .reduce((total, earlier) => total + earlier.findings.length, 0)
    return {
      pillar: result.pillar,
      model: result.model,
      skills: result.skills,
      usage: result.usage,
      ...(result.error === undefined ? {} : { error: result.error }),
      failedAttempts: result.failedAttempts,
      findings: result.findings.map((finding, at): ReportFinding => {
        const here = start + at
        if (output === undefined || kept.has(here)) return { ...finding, dropped: false }
        const reason = output.dropped.get(here)
        return {
          ...finding,
          dropped: true,
          ...(reason === undefined ? {} : { droppedReason: reason }),
        }
      }),
    }
  })
}

export function buildReport(input: ReportInput): ReportData {
  const output = input.verifier?.output
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
    pillars: markDropped(input.pillars, output),
    skipped: input.skipped,
    skillSelection: input.skillSelection,
    verifier:
      input.verifier === undefined
        ? null
        : { model: input.verifier.model, usage: input.verifier.output.usage },
  }
}

function spent(usage: Usage | null): number {
  return usage?.costUsd ?? 0
}

/** Cost of the skill selection, each pillar (failed attempts included), and the verifier. */
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
  return { selection, pillars, verifier, total: selection + pillars + verifier }
}
