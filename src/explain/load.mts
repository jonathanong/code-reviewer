import { join } from 'node:path'

import { SEVERITIES, type Finding, type Severity } from '../review/finding.mts'
import { deriveVerdict } from '../review/render.mts'
import { APPROVAL_CHECK } from '../review/skipped.mts'
import { findingId } from '../review/run/evidence-run.mts'
import { costBreakdown, type ReportData } from '../review/run/report.mts'
import { reportStack, type ReportStack } from '../review/run/stack-report.mts'
import type { StackFile } from '../review/stack-file.mts'
import { asNumber, asRecord, asString, readJson, type Json } from '../tracker/json.mts'

export type ExplainFinding = {
  severity: Severity
  title: string
  body: string
  path: string | null
  line: number | null
  startLine: number | null
  /** The later pull request in the stack that fixes it, when the review says so. */
  fixedIn: number | null
  /** What the check against real data concluded, when one ran. */
  checked: { effect: string; note: string } | null
}

export type ExplainQuestion = {
  text: string
  /** Who is asked; null for a question recorded without it. */
  askOf: 'author' | 'product' | null
  /** What the answer changes about the review; null when not recorded. */
  why: string | null
}

export type Explained = {
  repo: string | null
  pr: number | null
  title: string | null
  url: string | null
  head: string | null
  mode: 'full' | 'light' | 'follow-up' | null
  pullRequestSummary: string
  summary: string
  verdict: string | null
  /** Set when nothing was reviewed. */
  skipReason: string | null
  findings: ExplainFinding[]
  questions: ExplainQuestion[]
  /** The GitHub review event it was posted as, from the tracker; null when not known. */
  event: string | null
  /** Why that event is a COMMENT instead of the verdict's own event. */
  downgraded: string | null
  reviewedAreas: string[]
  notReviewed: { area: string; reason: string }[]
  /** Sources of real data the review could not use, with why. */
  blockedSources: { name: string; reason: string }[]
  checkedSources: number
  evidenceError: string | null
  stack: { position: number; total: number; staleBase: boolean; rootBase: string } | null
  costUsd: number | null
}

export type Fallback = { repo?: string; pr?: number; title?: string | null }

const QUESTION_KEYS = ['question', 'text', 'title', 'body']

function questionOf(entry: unknown): ExplainQuestion[] {
  if (typeof entry === 'string') return [{ text: entry, askOf: null, why: null }]
  const record = asRecord(entry)
  const key = QUESTION_KEYS.find((candidate) => typeof record[candidate] === 'string')
  if (key === undefined) return []
  const askOf = record.askOf === 'author' || record.askOf === 'product' ? record.askOf : null
  return [{ text: record[key] as string, askOf, why: asString(record.why) }]
}

function findingsOf(list: unknown): Finding[] {
  const entries = Array.isArray(list) ? list : []
  return entries.flatMap((entry) => {
    const record = asRecord(entry)
    const severity = SEVERITIES.find((candidate) => candidate === record.severity)
    const title = asString(record.title)
    if (severity === undefined || title === null) return []
    return [{ ...record, severity, title, body: asString(record.body) ?? '' } as unknown as Finding]
  })
}

function listOf(value: unknown): Json[] {
  return Array.isArray(value) ? value.map(asRecord) : []
}

function modeOf(sinceSha: string | null, mode: string | null): Explained['mode'] {
  if (sinceSha !== null) return 'follow-up'
  return mode === 'full' || mode === 'light' ? mode : null
}

function cost(report: Json): number | null {
  try {
    return costBreakdown(report as unknown as ReportData).total
  } catch {
    return null
  }
}

/** Reads the run's files, each optional, into what the explainer needs. */
export function loadRun(
  read: (path: string) => string | undefined,
  dir: string,
  fallback: Fallback,
): Explained | undefined {
  const file = (name: string) => readJson(read, join(dir, name))
  const report = file('report.json')
  const review = file('review.json')
  const evidenceFile = file('evidence.json')
  const plan = file('plan.json')
  const context = file('context.json')
  if (Object.keys(report).length === 0 && Object.keys(review).length === 0) return undefined
  const findings = findingsOf(review.findings ?? report.findings)
  const evidence = Object.keys(evidenceFile).length === 0 ? asRecord(report.evidence) : evidenceFile
  const stackFile = file('stack.json')
  const stack: ReportStack | undefined =
    report.stack === undefined
      ? Object.keys(stackFile).length === 0
        ? undefined
        : reportStack(stackFile as unknown as StackFile, findings)
      : (report.stack as ReportStack)
  const notes = new Map(
    listOf(evidence.findings).map((note) => [asString(note.id), asRecord(note)] as const),
  )
  const sources = listOf(evidence.sources)
  const areas = listOf(report.pillars)
  const skipped = listOf(review.skipped ?? report.skipped)
  const recorded = [review.questions, report.questions].find(Array.isArray) ?? []
  const questions = (recorded as unknown[]).flatMap(questionOf)
  return {
    repo: asString(report.repo) ?? fallback.repo ?? null,
    pr: asNumber(report.pr) ?? fallback.pr ?? null,
    title: asString(report.title) ?? asString(context.title) ?? fallback.title ?? null,
    url: asString(report.url),
    head: asString(report.headSha) ?? asString(context.headSha),
    mode: modeOf(asString(plan.sinceSha), asString(report.mode) ?? asString(plan.mode)),
    pullRequestSummary: asString(report.pullRequestSummary) ?? '',
    summary: asString(review.summary) ?? asString(report.summary) ?? '',
    verdict:
      asString(report.verdict) ??
      (Object.keys(review).length === 0
        ? null
        : deriveVerdict(
            findings,
            questions.map((item) => ({ question: item.text, askOf: 'author', why: '' })),
            skipped.flatMap((entry) =>
              entry.pillar === APPROVAL_CHECK ? [{ pillar: APPROVAL_CHECK, reason: '' }] : [],
            ),
          )),
    skipReason: asString(report.skipReason) ?? asString(plan.skipReason),
    findings: findings.map((finding, index) => {
      const note = notes.get(findingId(index))
      const fixed = stack?.fixedLater.find((entry) => entry.finding === index)
      return {
        severity: finding.severity,
        title: finding.title,
        body: finding.body,
        path: finding.path ?? null,
        line: finding.line ?? null,
        startLine: finding.startLine ?? null,
        fixedIn: fixed?.pr ?? null,
        checked:
          note === undefined
            ? null
            : { effect: asString(note.effect) ?? 'none', note: asString(note.note) ?? '' },
      }
    }),
    questions,
    event: null,
    downgraded: null,
    reviewedAreas: areas.flatMap((area) =>
      area.error === undefined ? [asString(area.pillar) ?? 'unknown'] : [],
    ),
    notReviewed: skipped.map((entry) => ({
      area: asString(entry.pillar) ?? 'unknown',
      reason: asString(entry.reason) ?? 'no reason recorded',
    })),
    blockedSources: sources.flatMap((source) =>
      source.status === 'blocked'
        ? [{ name: asString(source.name) ?? 'unnamed', reason: asString(source.reason) ?? '' }]
        : [],
    ),
    checkedSources: sources.filter((source) => source.status === 'checked').length,
    evidenceError: asString(evidence.error),
    stack:
      stack === undefined
        ? null
        : {
            position: stack.index + 1,
            total: stack.members.length,
            staleBase: stack.staleBase,
            rootBase: stack.rootBase,
          },
    costUsd: Object.keys(report).length === 0 ? null : cost(report),
  }
}
