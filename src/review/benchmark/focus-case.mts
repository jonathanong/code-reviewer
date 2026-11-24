import { ReviewError } from '../finding.mts'
import { FOCUS_STATUSES, MAX_FOCUS_POINTS, type FocusStatus } from '../focus.mts'

/** One expected outcome for the requester-focus step on a benchmark case. */
export type FocusCasePoint = {
  point: string
  expectedStatus: FocusStatus
  reason: string
  /** When true, the point passes only if the focus step also returned zero findings. */
  expectNoFindings?: boolean
}

type Json = Record<string, unknown>

const isRecord = (value: unknown): value is Json =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

function nonEmpty(record: Json, field: string, where: string): string {
  const value = record[field]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ReviewError(`${where}: ${field} must be a non-empty string`)
  }
  return value
}

/** Parses a case's optional `focus` list; absent when omitted. */
export function parseFocusCase(raw: unknown, where: string): { focus?: FocusCasePoint[] } {
  if (raw === undefined) return {}
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_FOCUS_POINTS) {
    throw new ReviewError(`${where}: focus must list 1 to ${MAX_FOCUS_POINTS} points`)
  }
  const focus = raw.map((entry, at): FocusCasePoint => {
    const here = `${where}.focus[${at}]`
    if (!isRecord(entry)) throw new ReviewError(`${here}: must be an object`)
    const status = FOCUS_STATUSES.find((candidate) => candidate === entry.expectedStatus)
    if (status === undefined) {
      throw new ReviewError(`${here}: expectedStatus must be one of ${FOCUS_STATUSES.join(', ')}`)
    }
    const { expectNoFindings } = entry
    if (expectNoFindings !== undefined && typeof expectNoFindings !== 'boolean') {
      throw new ReviewError(`${here}: expectNoFindings must be a boolean`)
    }
    if (expectNoFindings === true && status === 'does_not_hold') {
      throw new ReviewError(`${here}: a does_not_hold point cannot set expectNoFindings`)
    }
    return {
      point: nonEmpty(entry, 'point', here),
      expectedStatus: status,
      reason: nonEmpty(entry, 'reason', here),
      ...(expectNoFindings === undefined ? {} : { expectNoFindings }),
    }
  })
  return { focus }
}
