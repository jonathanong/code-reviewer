import { VERDICT_EVENTS } from '../review/event.mts'
import type { Severity } from '../review/finding.mts'
import type { Verdict } from '../review/render.mts'
import { APPROVAL_CHECK } from '../review/skipped.mts'
import type { ExplainFinding, ExplainQuestion, Explained } from './load.mts'
import type { ExplainFlag } from './notes.mts'

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

const ASKED: Record<NonNullable<ExplainQuestion['askOf']>, string> = {
  author: 'the author',
  product: 'whoever owns the product decision',
}

function question(entry: ExplainQuestion): string {
  const who = entry.askOf === null ? '' : `For ${ASKED[entry.askOf]}: `
  const why = entry.why === null || entry.why === '' ? '' : `\n  Why it matters: ${entry.why}`
  return `- ${who}${entry.text}${why}`
}

function flag(entry: ExplainFlag): string {
  return `- \`${entry.kind}\`${entry.where === null ? '' : ` (${entry.where})`}: ${entry.concern}`
}

const RULES =
  'The verdict follows three rules in order: a blocking problem means Request Changes; otherwise a high-severity problem or any open question means Comment; otherwise Approve.'

/** Why the verdict is what it is, in plain words, from the most severe finding or the questions. */
function reason(
  findings: readonly ExplainFinding[],
  questions: number,
  unchecked: boolean,
): string {
  const blocking = findings.find((entry) => entry.severity === 'blocking')
  const high = findings.find((entry) => entry.severity === 'high')
  const asked = `${questions} open question${questions === 1 ? ' is' : 's are'} still waiting for an answer`
  const why =
    blocking !== undefined
      ? `${WEIGHT.blocking}: ${blocking.title}. A blocking problem means Request Changes.`
      : high !== undefined
        ? `No blocking problem, but a high-severity one: ${high.title}.${questions > 0 ? ` Also, ${asked}.` : ''} That means Comment.`
        : questions > 0
          ? `No blocking or high-severity problem, but ${asked}. That means Comment: the reviewer cannot say yes or no until they are answered.`
          : unchecked
            ? 'No blocking or high-severity problem was found, and no question is open, but the second check on the approval did not finish. That means Comment: an approval nobody double-checked is not given.'
            : 'No blocking or high-severity problem was found, and no question is open. That means Approve.'
  return `${why}\n\n${RULES}`
}

function posted(run: Explained): string[] {
  if (run.event === null) return []
  const own = VERDICT_EVENTS[run.verdict as Verdict] as string | undefined
  if (run.event === own) return []
  const because: Record<string, string> = {
    'self-review':
      "the pull request is the reviewer's own, and GitHub does not let an account approve or request changes on its own pull request",
    'identity-unknown':
      'the reviewer could not confirm who wrote the pull request, so it posted the safe form',
    rejected: 'GitHub refused the verdict as a review event',
  }
  const reason =
    run.downgraded === null ? '' : ` because ${because[run.downgraded] ?? run.downgraded}`
  return [
    `On GitHub this was posted as ${run.event === 'COMMENT' ? 'a plain comment' : run.event}${reason}. The verdict above is still the reviewer's real conclusion.`,
  ]
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
  if (run.olderSkipped) {
    lines.push('Older resolved or hidden review history was not read; open threads were.')
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
    reason(
      sorted,
      run.questions.length,
      run.notReviewed.some((area) => area.area === APPROVAL_CHECK),
    ),
    ...posted(run),
    ...(run.summary === '' ? [] : [run.summary]),
    `## Findings (${sorted.length})`,
    sorted.length === 0 ? 'None.' : sorted.map(finding).join('\n\n'),
    '## Open questions',
    run.questions.length === 0 ? 'None.' : run.questions.map(question).join('\n'),
    ...(run.flags.length === 0
      ? []
      : [
          '## Flags',
          'A flag is a concern only a person can settle; `run --post auto` holds the review for it.',
          run.flags.map(flag).join('\n'),
        ]),
    ...(run.notes.length === 0
      ? []
      : ['## Notes', run.notes.map((note) => `- ${note}`).join('\n')]),
    ...(run.dependencies.length === 0
      ? []
      : [
          '## Depends on',
          run.dependencies
            .map((entry) => `- ${entry.on} (${entry.state}): ${entry.why}`)
            .join('\n'),
        ]),
    '## What was checked, and what was not',
    checked(run).join('\n'),
    '## Cost',
    run.costUsd === null ? 'Not recorded.' : `$${run.costUsd.toFixed(2)} to produce this review.`,
  ]
  return `${sections.join('\n\n')}\n`
}
