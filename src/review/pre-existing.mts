import type { Finding } from './finding.mts'
import { locationText, sortFindings } from './render.mts'

/** The most pre-existing items one review lists; the rest are only counted. */
export const MAX_PRE_EXISTING = 5

export const PRE_EXISTING_HEADING = '**FYI — pre-existing, not part of this review**'

const MAX_TITLE_CHARS = 120

/** The most characters of one FYI reason; the rest is cut so a long body cannot crowd the review. */
export const MAX_REASON_CHARS = 600

/** The summary of the collapsed block that holds an FYI's reason. */
export const REASON_SUMMARY = 'Why'

function clip(title: string): string {
  const line = title.replace(/\s+/gu, ' ')
  return line.length <= MAX_TITLE_CHARS ? line : `${line.slice(0, MAX_TITLE_CHARS - 1)}…`
}

function reason(body: string): string {
  const text = body.trim().replace(/<\/details>/giu, '&lt;/details>')
  const clipped = text.length <= MAX_REASON_CHARS ? text : `${text.slice(0, MAX_REASON_CHARS - 1)}…`
  return clipped
    .split('\n')
    .map((line) => (line === '' ? '' : `  ${line}`))
    .join('\n')
}

/** One FYI item: a line, then its reason collapsed under it (indented so it stays in the list item). */
function item(finding: Finding): string {
  const where = locationText(finding)
  const line = `- ${where === '' ? '' : `${where} — `}${clip(finding.title)}`
  if (finding.body.trim() === '') return line
  return `${line}\n  <details><summary>${REASON_SUMMARY}</summary>\n\n${reason(finding.body)}\n\n  </details>`
}

/** The FYI block of the review body: a line each with its reason collapsed, at most `MAX_PRE_EXISTING`, then a count; empty without any. */
export function preExistingSection(findings: readonly Finding[]): string[] {
  const items = sortFindings(findings.filter((finding) => finding.preExisting === true))
  if (items.length === 0) return []
  const lines = items.slice(0, MAX_PRE_EXISTING).map(item)
  const more = items.length - MAX_PRE_EXISTING
  if (more > 0) lines.push(`- and ${more} more`)
  return [`${PRE_EXISTING_HEADING}\n\n${lines.join('\n')}`]
}
