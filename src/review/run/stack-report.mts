import type { Finding } from '../finding.mts'
import type { StackFile } from '../stack-file.mts'

/** The stack as `report.json` shows it, with the findings the verifier marked as fixed later. */
export type ReportStack = {
  members: { number: number; title: string }[]
  /** Position of the pull request in `members`. */
  index: number
  rootBase: string
  rootIsDefault: boolean
  staleBase: boolean
  /** Verified findings downgraded because a later member fixes them: index into `findings`. */
  fixedLater: { finding: number; pr: number }[]
}

const FIXED_IN = /^Fixed in #(\d+): /u

export function reportStack(
  stack: StackFile | undefined,
  findings: readonly Finding[],
): ReportStack | undefined {
  if (stack === undefined) return undefined
  const later = new Set(stack.members.slice(stack.index + 1).map((member) => member.number))
  const fixedLater = findings.flatMap((finding, index) => {
    const pr = Number(FIXED_IN.exec(finding.body.trim())?.[1])
    return later.has(pr) ? [{ finding: index, pr }] : []
  })
  return {
    members: stack.members.map(({ number, title }) => ({
      number,
      title: title.replace(/\s+/gu, ' ').trim(),
    })),
    index: stack.index,
    rootBase: stack.rootBase,
    rootIsDefault: stack.rootIsDefault,
    staleBase: stack.staleBase,
    fixedLater,
  }
}

export function renderStack(stack: ReportStack): string[] {
  const members = stack.members
    .map(
      (member, at) =>
        `${at + 1}. #${member.number} ${member.title}${at === stack.index ? ' (this pull request)' : ''}`,
    )
    .join('\n')
  const base = stack.staleBase
    ? `Stale base: \`${stack.rootBase}\` is not the default branch and no open pull request has it as head.`
    : stack.rootIsDefault
      ? `Root base: \`${stack.rootBase}\`.`
      : `Off-base: the stack's root base \`${stack.rootBase}\` is not the default branch.`
  return [
    `### Stack (member ${stack.index + 1} of ${stack.members.length}, bottom-up)`,
    members,
    base,
  ]
}
