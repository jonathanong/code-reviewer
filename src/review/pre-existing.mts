import type { Finding } from './finding.mts'
import { locationText, sortFindings } from './render.mts'

/** The most pre-existing items one review lists; the rest are only counted. */
export const MAX_PRE_EXISTING = 5

export const PRE_EXISTING_HEADING = '**FYI — pre-existing, not part of this review**'

const MAX_TITLE_CHARS = 120

function clip(title: string): string {
  const line = title.replace(/\s+/gu, ' ')
  return line.length <= MAX_TITLE_CHARS ? line : `${line.slice(0, MAX_TITLE_CHARS - 1)}…`
}

/** The FYI block of the review body: one line each, at most `MAX_PRE_EXISTING`, then a count; empty without any. */
export function preExistingSection(findings: readonly Finding[]): string[] {
  const items = sortFindings(findings.filter((finding) => finding.preExisting === true))
  if (items.length === 0) return []
  const lines = items.slice(0, MAX_PRE_EXISTING).map((finding) => {
    const where = locationText(finding)
    return `- ${where === '' ? '' : `${where} — `}${clip(finding.title)}`
  })
  const more = items.length - MAX_PRE_EXISTING
  if (more > 0) lines.push(`- and ${more} more`)
  return [`${PRE_EXISTING_HEADING}\n\n${lines.join('\n')}`]
}
