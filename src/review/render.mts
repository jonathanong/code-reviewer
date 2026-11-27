import { classLine } from './class-line.mts'
import { focusSection } from './focus.mts'
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

/** The findings that count: those not marked pre-existing. FYI items never reach the verdict, counts or inline comments. */
export function actionable(findings: readonly Finding[]): Finding[] {
  return findings.filter((finding) => finding.preExisting !== true)
}

/**
 * Top-down: a blocking finding requests changes; else a high finding or an open question
 * comments; else approve. A failed pillar changes none of this: it is listed as skipped, and a
 * review where every pillar failed never reaches a verdict. An approval whose second check did not
 * complete is listed as skipped too, and is a comment: nothing double-checked it. A finding marked
 * pre-existing is an FYI and is ignored here.
 */
export function deriveVerdict(
  all: readonly Finding[],
  questions: readonly Question[],
  skipped: readonly SkippedPillar[] = [],
): Verdict {
  const findings = actionable(all)
  if (findings.some((finding) => finding.severity === 'blocking')) return 'Request Changes'
  if (findings.some((finding) => finding.severity === 'high')) return 'Comment'
  if (questions.length > 0) return 'Comment'
  if (skipped.some((entry) => entry.pillar === APPROVAL_CHECK)) return 'Comment'
  return 'Approve'
}

export function severityTag(severity: Severity): string {
  return `[${severity}]`
}

/** The tag that heads a finding in the posted text: its severity and its pillar. */
export function findingTag(finding: Finding): string {
  return `[${finding.severity} · ${finding.pillar}]`
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

/** The summary of the collapsed block that holds what only whoever fixes the finding needs. */
export const FIX_SUMMARY = 'For the fix'

/** The fixer-only detail and the prevention note in one collapsed block; empty when both are absent. */
function fixSection(finding: Finding): string {
  const parts = [
    ...(finding.fix === undefined ? [] : [finding.fix.replace(/<\/details>/giu, '&lt;/details>')]),
    ...(finding.prevent === undefined ? [] : [`**Prevent:** ${finding.prevent}`]),
  ]
  return parts.length === 0 ? '' : `\n\n${detail(FIX_SUMMARY, parts.join('\n\n'))}`
}

/** A fence longer than any run of backticks in `text`, so the text cannot close it early. */
function fenceFor(text: string): string {
  const longest = Math.max(0, ...(text.match(/`+/gu) ?? []).map((run) => run.length))
  return '`'.repeat(Math.max(3, longest + 1))
}

/**
 * The GitHub suggestion block for an inline comment, empty when the finding cannot carry one: no
 * line to anchor to, a deleted (`LEFT`) line, or a pre-existing FYI.
 */
function suggestionSection(finding: Finding): string {
  if (finding.suggestion === undefined || finding.preExisting === true) return ''
  if (finding.path === undefined || finding.line === undefined || finding.side === 'LEFT') return ''
  const fence = fenceFor(finding.suggestion)
  return `\n\n${fence}suggestion\n${finding.suggestion}\n${fence}`
}

/** Renders a finding: tag and title up front, short bodies inline, long bodies collapsed. */
export function renderFindingBody(finding: Finding): string {
  const head = `**${findingTag(finding)}** ${finding.title}`
  const body = isShort(finding.body) ? finding.body : detail('Details', finding.body)
  return `${head}\n\n${body}${suggestionSection(finding)}${fixSection(finding)}${raisedByLine(finding.raisedBy)}`
}

/** Renders a finding that has no commentable diff line, for the review body. */
export function renderBodyFinding(finding: Finding): string {
  const where = locationText(finding)
  const summary = `${findingTag(finding)} ${finding.title}${where ? ` (${where})` : ''}`
  return detail(
    summary.replace(/`/gu, ''),
    `${finding.body}${fixSection(finding)}${raisedByLine(finding.raisedBy)}`,
  )
}

const ORDER: readonly Severity[] = ['blocking', 'high', 'medium', 'low']

export function sortFindings<T extends Finding>(findings: readonly T[]): T[] {
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

/** The proposal to split a large change, for the person reading: one line, not collapsed. */
export function splitSection(proposal: string | undefined): string[] {
  return proposal === undefined ? [] : [`**Consider splitting this up:** ${proposal}`]
}

function skippedSection(skipped: readonly SkippedPillar[]): string[] {
  if (skipped.length === 0) return []
  const rows = skipped.map((entry) => `- **${entry.pillar}**: ${entry.reason}`).join('\n')
  return [detail(`Skipped pillars (${skipped.length})`, rows)]
}

/** The ask under the index of an approval that still lists findings: none blocks, each is resolved before merge. */
export const RESOLVE_NOTE =
  'None of these blocks the merge. Resolve each before merging: fix it, reply with why it stays, or link a follow-up issue.'

/** Renders the review's top section: verdict, reviewed SHA, class, summary, and the finding index. */
export function renderHeader(
  input: ReviewInput,
  headSha: string,
  paths: readonly string[] = [],
): string {
  const verdict = deriveVerdict(input.findings, input.questions, input.skipped)
  const found = actionable(input.findings)
  const index = sortFindings(found).map((finding) => {
    const where = locationText(finding)
    return `- **${severityTag(finding.severity)}** ${finding.title}${where ? ` — ${where}` : ''}`
  })
  return [
    reviewMarker(headSha, verdict, input.effort),
    `## [${verdict}] Code review`,
    `Reviewed \`${headSha.slice(0, 12)}\` at ${input.effort} effort · ${counts(found)}`,
    ...classLine(paths, input.impact),
    ...(input.summary ? [input.summary] : []),
    ...splitSection(input.splitProposal),
    ...(index.length > 0 ? [index.join('\n')] : []),
    ...(verdict === 'Approve' && found.length > 0 ? [RESOLVE_NOTE] : []),
    ...renderQuestions(input.questions),
    ...focusSection(input.focus),
    ...notesSection(input.notes),
    ...dependsOnSection(input.dependencies),
    ...regressionSection(input.regressionPrevent),
    ...skippedSection(input.skipped),
  ].join('\n\n')
}
