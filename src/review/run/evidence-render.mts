import type { Finding } from '../finding.mts'
import { findingId } from './evidence-run.mts'
import type { EvidenceCommand, EvidenceReport, EvidenceSourceReport } from './evidence-types.mts'

/** A command or note as one inline span; the text came from a model, so it cannot end the span. */
const code = (text: string) => `\`${text.replaceAll('`', "'")}\``

function quote(text: string): string {
  return text === ''
    ? '> (empty)'
    : text
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n')
}

function ran(label: string, step: EvidenceCommand): string {
  return `${label} ${code(step.command)}\n\n${quote(step.result)}`
}

function source(report: EvidenceSourceReport): string {
  const lines = [
    `#### ${report.name}: ${report.status}`,
    ...(report.reason === undefined ? [] : [report.reason]),
    ...report.queries.map((query) =>
      [
        ran('Query', query),
        ...(query.control === undefined ? [] : [ran('Control', query.control)]),
      ].join('\n\n'),
    ),
  ]
  return lines.join('\n\n')
}

/**
 * The Evidence section of `report.md`: per source the status and every query with its control,
 * then what the run concluded about each finding and about the pull request's own claims.
 */
export function renderEvidence(
  evidence: EvidenceReport,
  findings: readonly Finding[],
  cost: string,
): string[] {
  const titles = new Map(findings.map((finding, index) => [findingId(index), finding.title]))
  const notes = evidence.findings.map(
    (note) =>
      `- ${note.id} ${titles.get(note.id)}: ${note.effect}${note.note === '' ? '' : `. ${note.note}`}`,
  )
  const claims = evidence.claims.map(
    (claim) =>
      `- ${code(claim.claim)}: ${claim.effect}${claim.note === '' ? '' : `. ${claim.note}`}`,
  )
  return [
    '### Evidence',
    'Evidence never drops a finding or changes a severity or the verdict.',
    evidence.usage === null && evidence.failedAttempts.length === 0
      ? 'No evidence run was made.'
      : `Run: ${evidence.model}, ${cost}${evidence.failedAttempts.length === 0 ? '' : `, including ${evidence.failedAttempts.length} failed attempt(s)`}.`,
    ...(evidence.error === undefined ? [] : [`Failed: ${evidence.error}`]),
    ...evidence.sources.map(source),
    ...(notes.length === 0 ? [] : ['Findings:', notes.join('\n')]),
    ...(claims.length === 0 ? [] : ['Pull request claims:', claims.join('\n')]),
  ]
}
