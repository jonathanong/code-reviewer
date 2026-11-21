import { dependsOnSection } from './dependency-render.mts'
import { notesSection } from './notes.mts'
import type { Effort, ReviewInput, Finding, Severity, SkippedPillar } from './finding.mts'
import { renderQuestions, type Question } from './question.mts'
import { raisedByLine } from './raised-by.mts'
import { APPROVAL_CHECK } from './skipped.mts'

export const VERDICTS = ['Approve', 'Request Changes', 'Comment'] as const
export type Verdict = (typeof VERDICTS)[number]

const SHORT_BODY_CHARS = 400
const SHORT_BODY_LINES = 4

/**
 * Top-down: a blocking finding requests changes; else a high finding or an open question
 * comments; else approve. A failed pillar changes none of this: it is listed as skipped, and a
 * review where every pillar failed never reaches a verdict. An approval whose second check did not
 * complete is listed as skipped too, and is a comment: nothing double-checked it.
 */
export function deriveVerdict(
  findings: readonly Finding[],
  questions: readonly Question[],
  skipped: readonly SkippedPillar[] = [],
): Verdict {
  if (findings.some((finding) => finding.severity === 'blocking')) return 'Request Changes'
  if (findings.some((finding) => finding.severity === 'high')) return 'Comment'
  if (questions.length > 0) return 'Comment'
  if (skipped.some((entry) => entry.pillar === APPROVAL_CHECK)) return 'Comment'
  return 'Approve'
}

export function severityTag(severity: Severity): string {
  return `[${severity}]`
}

export function locationText(finding: Finding): string {
  if (finding.path === undefined) return ''
  if (finding.line === undefined) return `\`${finding.path}\``
  const range = finding.startLine === undefined ? '' : `${finding.startLine}-`
  return `\`${finding.path}:${range}${finding.line}\``
}

function detail(summary: string, body: string): string {
  return `<details><summary>${summary}</summary>\n\n${body}\n\n</details>`
}

function isShort(body: string): boolean {
  return body.length <= SHORT_BODY_CHARS && body.split('\n').length <= SHORT_BODY_LINES
}

/** The prevention note and the credit to another reviewer, each after a blank line; empty when absent. */
function preventLine(finding: Finding): string {
  const prevent = finding.prevent === undefined ? '' : `\n\n**Prevent:** ${finding.prevent}`
  return `${prevent}${raisedByLine(finding.raisedBy)}`
}

/** Renders a finding: tag and title up front, short bodies inline, long bodies collapsed. */
export function renderFindingBody(finding: Finding): string {
  const head = `**${severityTag(finding.severity)}** ${finding.title}\n\n<sub>${finding.pillar}</sub>`
  const body = isShort(finding.body) ? finding.body : detail('Details', finding.body)
  return `${head}\n\n${body}${preventLine(finding)}`
}

/** Renders a finding that has no commentable diff line, for the review body. */
export function renderBodyFinding(finding: Finding): string {
  const where = locationText(finding)
  const summary = `${severityTag(finding.severity)} ${finding.title}${where ? ` (${where})` : ''}`
  return detail(
    summary.replace(/`/gu, ''),
    `<sub>${finding.pillar}</sub>\n\n${finding.body}${preventLine(finding)}`,
  )
}

const ORDER: readonly Severity[] = ['blocking', 'high', 'medium', 'low']

export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => ORDER.indexOf(a.severity) - ORDER.indexOf(b.severity))
}

function counts(findings: readonly Finding[]): string {
  if (findings.length === 0) return 'no findings'
  const parts = ORDER.flatMap((severity) => {
    const count = findings.filter((finding) => finding.severity === severity).length
    return count === 0 ? [] : [`${count} ${severity}`]
  })
  const noun = findings.length === 1 ? 'finding' : 'findings'
  return `${findings.length} ${noun} (${parts.join(', ')})`
}

/** Hidden marker other agents parse to tie a review and its label to one head SHA. */
export function reviewMarker(
  headSha: string,
  verdict: Verdict | 'Skipped',
  effort: Effort,
): string {
  return `<!-- final-review sha=${headSha} verdict=${verdict.replace(' ', '-')} effort=${effort} -->`
}

/** The rule or test that would have caught the regression this change fixes; collapsed. */
export function regressionSection(prevent: string | undefined): string[] {
  return prevent === undefined ? [] : [detail('Preventing this regression', prevent)]
}

function skippedSection(skipped: readonly SkippedPillar[]): string[] {
  if (skipped.length === 0) return []
  const rows = skipped.map((entry) => `- **${entry.pillar}**: ${entry.reason}`).join('\n')
  return [detail(`Skipped pillars (${skipped.length})`, rows)]
}

/** Renders the review's top section: verdict, reviewed SHA, summary, and the finding index. */
export function renderHeader(input: ReviewInput, headSha: string): string {
  const verdict = deriveVerdict(input.findings, input.questions, input.skipped)
  const index = sortFindings(input.findings).map((finding) => {
    const where = locationText(finding)
    return `- **${severityTag(finding.severity)}** ${finding.title}${where ? ` — ${where}` : ''}`
  })
  return [
    reviewMarker(headSha, verdict, input.effort),
    `## [${verdict}] Code review`,
    `Reviewed \`${headSha.slice(0, 12)}\` at ${input.effort} effort · ${counts(input.findings)}`,
    ...(input.summary ? [input.summary] : []),
    ...(index.length > 0 ? [index.join('\n')] : []),
    ...renderQuestions(input.questions),
    ...notesSection(input.notes),
    ...dependsOnSection(input.dependencies),
    ...regressionSection(input.regressionPrevent),
    ...skippedSection(input.skipped),
  ].join('\n\n')
}
