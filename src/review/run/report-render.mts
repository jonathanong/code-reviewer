import type { Usage } from '../benchmark/usage.mts'
import { renderModelTable } from '../benchmark/usage-summary.mts'
import type { Finding } from '../finding.mts'
import { locationText } from '../render.mts'
import { renderStack } from './stack-report.mts'
import { renderEvidence } from './evidence-render.mts'
import { costBreakdown, type ReportData, type ReportFinding, type ReportPillar } from './report.mts'

function money(value: number | null): string {
  return value === null ? 'n/a' : `$${value.toFixed(4)}`
}

function quote(text: string): string {
  return text
    .trim()
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function where(finding: Finding): string {
  const location = locationText(finding)
  return location === '' ? '' : ` (${location})`
}

function verified(finding: Finding, index: number, fixedIn?: number): string {
  const later = fixedIn === undefined ? '' : ` (fixed in a later member, #${fixedIn})`
  const head = `${index + 1}. **[${finding.severity}]** ${finding.title}${where(finding)} (${finding.pillar})${later}`
  return `${head}\n\n${quote(finding.body)}`
}

function raw(finding: ReportFinding): string {
  const status = finding.dropped
    ? ` — dropped${finding.droppedReason === undefined ? '' : `: ${finding.droppedReason}`}`
    : ' — kept'
  return `- **[${finding.severity}]** ${finding.title}${where(finding)}${status}\n\n${quote(finding.body)}`
}

function usageLine(usage: Usage | null): string {
  if (usage === null) return 'no usage recorded'
  const turns = usage.turns === null ? 'n/a' : String(usage.turns)
  return `${money(usage.costUsd)}, ${turns} turns`
}

function pillar(result: ReportPillar): string {
  const lines = [
    `#### ${result.pillar} (${result.model})`,
    `Skills loaded: ${result.skills.length === 0 ? 'none' : result.skills.join(', ')}`,
    `Cost: ${usageLine(result.usage)}${result.failedAttempts.length === 0 ? '' : `, plus ${result.failedAttempts.length} failed attempt(s)`}`,
  ]
  if (result.error !== undefined) lines.push(`Failed: ${result.error}`)
  else if (result.findings.length === 0) lines.push('No findings.')
  else lines.push(`Findings (${result.findings.length}):`, ...result.findings.map(raw))
  return lines.join('\n\n')
}

/** The report section for one pull request; a pure function of `report.json`. */
export function renderReport(data: ReportData): string {
  const cost = costBreakdown(data)
  const sections = [
    `## ${data.repo}#${data.pr}: ${data.title}`,
    `[${data.url}](${data.url}) · head \`${data.headSha.slice(0, 7)}\``,
    `**Mode:** ${data.mode} · **Effort:** ${data.effort}`,
    ...(data.reasons.length === 0 ? [] : [data.reasons.map((reason) => `- ${reason}`).join('\n')]),
    ...(data.stack === undefined ? [] : renderStack(data.stack)),
  ]
  if (data.skipReason !== undefined) {
    sections.push(`**Skipped:** ${data.skipReason}`, `Total cost: ${money(cost.total)}`)
    return `${sections.join('\n\n')}\n`
  }
  sections.push(
    '### What the pull request does',
    data.pullRequestSummary === ''
      ? '_The verifier returned no summary._'
      : data.pullRequestSummary,
    `### Verdict: ${data.verdict ?? 'none'}`,
    data.summary,
    `### Verified findings (${data.findings.length})`,
    data.findings.length === 0
      ? 'None.'
      : data.findings
          .map((finding, at) =>
            verified(finding, at, data.stack?.fixedLater.find((entry) => entry.finding === at)?.pr),
          )
          .join('\n\n'),
    ...(data.fixedThreadIds.length === 0
      ? []
      : [
          '### Fixed since the last review',
          `After posting, run \`code-reviewer resolve --repo ${data.repo} --pr ${data.pr} --thread ${data.fixedThreadIds.join(' ')}\`.`,
        ]),
    ...(data.evidence === undefined
      ? []
      : renderEvidence(data.evidence, data.findings, money(cost.evidence))),
    '### Pillars',
    `Skills selected: ${data.skillSelection.selected.length === 0 ? 'none' : data.skillSelection.selected.join(', ')}${data.skillSelection.error === undefined ? '' : ` (selection error: ${data.skillSelection.error})`}`,
    ...data.pillars.map(pillar),
    '### Skipped pillars',
    data.skipped.length === 0
      ? 'None.'
      : data.skipped.map((entry) => `- ${entry.pillar}: ${entry.reason}`).join('\n'),
    '### Cost',
    `Total: ${money(cost.total)} (skill selection ${money(cost.selection)}, pillars ${money(cost.pillars)}, verifier ${money(cost.verifier)}${data.verifier === null ? '' : `, ${data.verifier.model}`}${data.evidence === undefined ? '' : `, evidence ${money(cost.evidence)}`})`,
    '### Tokens by model',
    'Input counts fresh, cache read and cache creation tokens. Failed attempts are included.',
    renderModelTable(data.usageByModel, 'Step'),
  )
  return `${sections.join('\n\n')}\n`
}
