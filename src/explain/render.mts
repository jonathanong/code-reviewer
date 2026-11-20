import type { Severity } from '../review/finding.mts'
import type { ExplainFinding, Explained } from './load.mts'

const ORDER: Severity[] = ['blocking', 'high', 'medium', 'low']

const WEIGHT: Record<Severity, string> = {
  blocking: 'Must fix',
  high: 'Should fix before merge',
  medium: 'Worth fixing',
  low: 'Minor',
}

const MODE: Record<NonNullable<Explained['mode']>, string> = {
  full: 'a full review',
  light: 'a light review, with fewer checks than a full one',
  'follow-up': 'a follow-up review of the changes since the last review',
}

const quote = (text: string) =>
  text
    .trim()
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')

function where(finding: ExplainFinding): string {
  if (finding.path === null) return 'not tied to one line'
  if (finding.line === null) return `\`${finding.path}\``
  const range = finding.startLine === null ? '' : `${finding.startLine}-`
  return `\`${finding.path}:${range}${finding.line}\``
}

function finding(entry: ExplainFinding, index: number): string {
  const lines = [
    `### ${index + 1}. ${WEIGHT[entry.severity]}: ${entry.title}`,
    `Where: ${where(entry)}`,
    entry.body.trim() === ''
      ? 'The reviewer gave no further explanation.'
      : `Why it matters, and what would fix it:\n\n${quote(entry.body)}`,
  ]
  if (entry.fixedIn !== null) {
    lines.push(`A later pull request in the stack, #${entry.fixedIn}, already fixes this.`)
  }
  if (entry.checked !== null && entry.checked.effect !== 'none') {
    const verdict =
      entry.checked.effect === 'supports'
        ? 'The data agrees with this finding.'
        : 'The data contradicts this finding, so treat it with care.'
    lines.push(
      `Checked against real data: ${verdict}${entry.checked.note === '' ? '' : ` ${entry.checked.note}`}`,
    )
  }
  return lines.join('\n\n')
}

/** The one reason for the verdict: the most severe finding, or that there is none. */
function reason(findings: readonly ExplainFinding[]): string {
  const top = findings.find((entry) => entry.severity === 'blocking' || entry.severity === 'high')
  return top === undefined
    ? 'No blocking or high-severity problem was found.'
    : `${WEIGHT[top.severity]}: ${top.title}.`
}

function checked(run: Explained): string[] {
  const lines: string[] = []
  if (run.reviewedAreas.length > 0) lines.push(`Reviewed for: ${run.reviewedAreas.join(', ')}.`)
  for (const area of run.notReviewed) lines.push(`Not reviewed, ${area.area}: ${area.reason}`)
  for (const source of run.blockedSources) {
    lines.push(
      `Could not check against ${source.name}${source.reason === '' ? '' : `: ${source.reason}`}`,
    )
  }
  if (run.evidenceError !== null)
    lines.push(`The check against real data failed: ${run.evidenceError}`)
  else if (run.checkedSources > 0) {
    lines.push(`Findings were checked against ${run.checkedSources} source(s) of real data.`)
  }
  if (run.stack !== null) {
    lines.push(
      `This is pull request ${run.stack.position} of ${run.stack.total} in a stack, reviewed in the context of the others.${run.stack.staleBase ? ` Its base branch \`${run.stack.rootBase}\` is not the default branch and no open pull request has it as head, so the base may be stale.` : ''}`,
    )
  }
  return lines.length === 0 ? ['No record of what was checked.'] : lines.map((line) => `- ${line}`)
}

/** A Markdown explainer for a reader who has not read the code, built only from the run's files. */
export function renderExplained(run: Explained): string {
  const name = run.repo === null || run.pr === null ? 'Pull request' : `${run.repo}#${run.pr}`
  const sorted = ORDER.flatMap((severity) =>
    run.findings.filter((entry) => entry.severity === severity),
  )
  const head = [
    `# ${name}${run.title === null ? '' : `: ${run.title}`}`,
    [
      ...(run.url === null ? [] : [run.url]),
      ...(run.head === null ? [] : [`head ${run.head.slice(0, 7)}`]),
      ...(run.mode === null ? [] : [`This was ${MODE[run.mode]}.`]),
    ].join(' · '),
  ].filter((line) => line !== '')
  if (run.skipReason !== null) {
    return `${[...head, '## Verdict', `Nothing was reviewed: ${run.skipReason}`].join('\n\n')}\n`
  }
  const sections = [
    ...head,
    '## What this pull request does',
    run.pullRequestSummary === ''
      ? 'No description of the change was recorded.'
      : run.pullRequestSummary,
    `## Verdict: ${run.verdict ?? 'not recorded'}`,
    reason(sorted),
    ...(run.summary === '' ? [] : [run.summary]),
    `## Findings (${sorted.length})`,
    sorted.length === 0 ? 'None.' : sorted.map(finding).join('\n\n'),
    '## Open questions',
    run.questions.length === 0
      ? 'None.'
      : run.questions.map((question) => `- ${question}`).join('\n'),
    '## What was checked, and what was not',
    checked(run).join('\n'),
    '## Cost',
    run.costUsd === null ? 'Not recorded.' : `$${run.costUsd.toFixed(2)} to produce this review.`,
  ]
  return `${sections.join('\n\n')}\n`
}
