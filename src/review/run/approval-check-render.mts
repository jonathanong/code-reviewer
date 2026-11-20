import type { ApprovalCheck } from './approval-check.mts'

const added = (count: number, noun: string) => `${count} ${noun}${count === 1 ? '' : 's'}`

/** The report section on the second check; empty when the review did not get one. */
export function renderApprovalCheck(check: ApprovalCheck | undefined): string[] {
  if (check === undefined) return []
  const head = '### Second check on the approval'
  if (check.outcome === 'failed') {
    return [
      `${head}\n\nDid not complete (${check.error ?? 'no reason recorded'}). It is listed as skipped, so the verdict is ${check.verdictAfter}, not Approve.`,
    ]
  }
  const changes = `added ${added(check.findings.length, 'finding')} and ${added(check.questions.length, 'question')}`
  const verdict =
    check.outcome === 'changed'
      ? `the verdict changed from ${check.verdictBefore} to ${check.verdictAfter}`
      : 'the approval stands'
  const note = check.note === '' ? '' : `\n\n${check.note}`
  return [`${head}\n\nRan (${check.model}), ${changes}; ${verdict}.${note}`]
}
