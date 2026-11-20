import type { ReportStack } from '../review/run/stack-report.mts'
import { asRecord, asString } from '../tracker/json.mts'

/** The review's notes about the pull request itself; anything that is not a string is dropped. */
export function notesOf(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : []).flatMap((note) => (typeof note === 'string' ? [note] : []))
}

/** What the review says the pull request depends on; entries without a name are dropped. */
export function dependenciesOf(raw: unknown) {
  return (Array.isArray(raw) ? raw : []).flatMap((entry) => {
    const record = asRecord(entry)
    const on = asString(record.on)
    return on === null
      ? []
      : [{ on, state: asString(record.state) ?? 'unknown', why: asString(record.why) ?? '' }]
  })
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
