import { ReviewError } from '../finding.mts'
import { FOCUS_STATUSES, MAX_FOCUS_POINTS, type FocusStatus } from '../focus.mts'
import { builtInTargets, type ReviewTarget } from '../targets.mts'

/** One expected outcome for the requester-focus step on a benchmark case. */
export type FocusCasePoint = {
  point: string
  /** Set when `point` was resolved verbatim from a built-in target file instead of inline text. */
  target?: string
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

function resolvePoint(
  entry: Json,
  here: string,
  targets: readonly ReviewTarget[] | undefined,
): { point: string; target?: string } {
  if (entry.point !== undefined && entry.target !== undefined) {
    throw new ReviewError(`${here}: set only one of point and target`)
  }
  if (entry.target !== undefined) {
    const name = nonEmpty(entry, 'target', here)
    const found = (targets ?? builtInTargets()).find((item) => item.name === name)
    if (found === undefined) throw new ReviewError(`${here}: unknown target "${name}"`)
    return { point: found.point, target: found.name }
  }
  return { point: nonEmpty(entry, 'point', here) }
}

/** Parses a case's optional `focus` list; absent when omitted. */
export function parseFocusCase(
  raw: unknown,
  where: string,
  targets?: readonly ReviewTarget[],
): { focus?: FocusCasePoint[] } {
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
      ...resolvePoint(entry, here, targets),
      expectedStatus: status,
      reason: nonEmpty(entry, 'reason', here),
      ...(expectNoFindings === undefined ? {} : { expectNoFindings }),
    }
  })
  return { focus }
}

const SHA_RE = /^[0-9a-f]{40}$/u
const PR_NUMBER_RE = /^[1-9][0-9]{0,8}$/u

/**
 * Parses a case's optional `focusRefs`: pull request number to the full commit the benchmark uses
 * for that pull request's head, so a case that names another pull request stays reproducible.
 */
export function parseFocusRefs(
  raw: unknown,
  where: string,
): { focusRefs?: Record<string, string> } {
  if (raw === undefined) return {}
  if (!isRecord(raw) || Object.keys(raw).length === 0) {
    throw new ReviewError(`${where}: focusRefs must map pull request numbers to commits`)
  }
  for (const [number, sha] of Object.entries(raw)) {
    if (!PR_NUMBER_RE.test(number)) {
      throw new ReviewError(`${where}: focusRefs key "${number}" must be a pull request number`)
    }
    if (typeof sha !== 'string' || !SHA_RE.test(sha)) {
      throw new ReviewError(`${where}: focusRefs.${number} must be a full 40-character commit`)
    }
  }
  return { focusRefs: raw as Record<string, string> }
}

/** A case's focus points and the pull request heads they may name. */
export type FocusFields = {
  focus?: FocusCasePoint[]
  /** Pull request number to the commit used as its head when a focus point names it. */
  focusRefs?: Record<string, string>
}

/** Parses `focus` and `focusRefs` of a raw case. */
export const parseFocusFields = (
  raw: Json,
  where: string,
  targets?: readonly ReviewTarget[],
): FocusFields => ({
  ...parseFocusCase(raw.focus, where, targets),
  ...parseFocusRefs(raw.focusRefs, where),
})
