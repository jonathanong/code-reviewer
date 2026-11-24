import type { FocusAnswer } from '../focus.mts'

export type ReportFocus = {
  /** Outcomes of requester and target focus checks, with origin; absent when no focus step ran. */
  focus?: FocusAnswer[]
  /** Selected built-in targets omitted because requester points filled the 20-point cap. */
  droppedTargets?: string[]
}

export function reportFocus(
  focus: readonly FocusAnswer[] | undefined,
  droppedTargets: readonly string[] | undefined,
): ReportFocus {
  return {
    ...(focus === undefined || focus.length === 0 ? {} : { focus: [...focus] }),
    ...(droppedTargets === undefined || droppedTargets.length === 0
      ? {}
      : { droppedTargets: [...droppedTargets] }),
  }
}

/** Report section listing every focus check outcome (requester and target) with its origin. */
export function renderFocusReport(
  focus: readonly FocusAnswer[] | undefined,
  droppedTargets?: readonly string[],
): string[] {
  const hasFocus = focus !== undefined && focus.length > 0
  const hasDropped = droppedTargets !== undefined && droppedTargets.length > 0
  if (!hasFocus && !hasDropped) return []
  const lines: string[] = []
  if (hasFocus) {
    lines.push(
      ...focus.map((entry) => {
        const origin = entry.origin ?? 'requester'
        const line = entry.line === undefined ? '' : `:${entry.line}`
        const where = entry.path === undefined ? '' : ` (\`${entry.path}${line}\`)`
        return `- [${origin}] **${entry.status}**: "${entry.point}" — ${entry.basis}${where}`
      }),
    )
  }
  if (hasDropped) {
    lines.push(`Targets dropped by the 20-point cap: ${droppedTargets.join(', ')}.`)
  }
  return ['### Focus checks', lines.join('\n')]
}
