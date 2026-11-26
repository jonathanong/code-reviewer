import { FLAG_KINDS, type Flag } from '../review/flag.mts'
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

/** A concern only a person can settle, as the review recorded it. */
export type ExplainFlag = Pick<Flag, 'kind' | 'concern'> & { where: string | null }

/** The flags a review recorded; an unknown kind or one without a concern is dropped. */
export function flagOf(entry: unknown): ExplainFlag[] {
  const record = asRecord(entry)
  const kind = FLAG_KINDS.find((candidate) => candidate === record.kind)
  const concern = asString(record.concern)
  return kind === undefined || concern === null
    ? []
    : [{ kind, concern, where: asString(record.where) }]
}
