import type { ReportStack } from '../review/run/stack-report.mts'

/** The review's notes about the pull request itself; anything that is not a string is dropped. */
export function notesOf(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : []).flatMap((note) => (typeof note === 'string' ? [note] : []))
}

/** Where the pull request sits in its stack, or null when it is not in one. */
export function stackView(stack: ReportStack | undefined) {
  return stack === undefined
    ? null
    : {
        position: stack.index + 1,
        total: stack.members.length,
        staleBase: stack.staleBase,
        rootBase: stack.rootBase,
      }
}
