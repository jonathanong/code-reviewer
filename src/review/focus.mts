import { extraPillar } from './pillar-name.mts'
import { isRecord, oneOf, ReviewError, text } from './finding.mts'
import { normalizeSpace } from './answers.mts'

/** The pillar name of the findings the requester-focus step raises. Reserved: a config may not use it. */
export const FOCUS_PILLAR = extraPillar('focus')

export const FOCUS_STATUSES = ['holds', 'does_not_hold', 'not_checked'] as const
export type FocusStatus = (typeof FOCUS_STATUSES)[number]

/** Where a focus point came from: the requester's `--focus` file or a built-in target check. */
export type FocusOrigin = 'requester' | `target:${string}`

/** One point submitted to the focus step, carrying its origin. */
export type FocusPoint = { point: string; origin: FocusOrigin }

const TARGET_ORIGIN_RE = /^target:[a-z][a-z0-9-]*$/u

export const isFocusOrigin = (value: unknown): value is FocusOrigin =>
  value === 'requester' || (typeof value === 'string' && TARGET_ORIGIN_RE.test(value))

/** What the focus step found for one point. */
export type FocusAnswer = {
  /** The point as supplied. */
  point: string
  /** Where the point came from; absent in older `review.json` files (treated as `requester`). */
  origin?: FocusOrigin
  status: FocusStatus
  /** One sentence: why it holds or not, or why it could not be checked. */
  basis: string
  path?: string
  line?: number
}

/** A path that is safe to post in code formatting: short, one line, no markup or mention. */
export const isSafePath = (path: string): boolean =>
  path.trim() !== '' && path.length <= 300 && !/[`<>@\r\n]/u.test(path)

export const MAX_FOCUS_POINTS = 20
export const MAX_FOCUS_CHARS = 500

/** Counts Unicode code points, not UTF-16 code units or UTF-8 bytes. */
export const charLength = (value: string): number => Array.from(value).length

/** Slices by Unicode code points so surrogate pairs are never split. */
export const sliceChars = (value: string, max: number): string =>
  Array.from(value).slice(0, max).join('')

/** The optional `focus` of a `review.json`; a malformed entry fails the input. */
export function parseFocus(raw: unknown): { focus?: FocusAnswer[] } {
  if (raw === undefined) return {}
  if (!Array.isArray(raw)) throw new ReviewError('focus must be an array.')
  const focus = raw.slice(0, MAX_FOCUS_POINTS).map((entry: unknown, index): FocusAnswer => {
    const where = `focus[${index}]`
    if (!isRecord(entry)) throw new ReviewError(`${where} must be an object.`)
    const { path, line, origin } = entry
    if (origin !== undefined && !isFocusOrigin(origin)) {
      throw new ReviewError(`${where}.origin must be "requester" or "target:<name>".`)
    }
    if (path !== undefined && (typeof path !== 'string' || !isSafePath(path))) {
      throw new ReviewError(`${where}.path must be a short plain file path.`)
    }
    if (line !== undefined && (!Number.isInteger(line) || (line as number) < 1)) {
      throw new ReviewError(`${where}.line must be a positive integer.`)
    }
    return {
      point: sliceChars(normalizeSpace(text(entry, 'point', where)), MAX_FOCUS_CHARS),
      ...(origin === undefined ? {} : { origin }),
      status: oneOf(FOCUS_STATUSES, entry.status, `${where}.status`),
      basis: normalizeSpace(text(entry, 'basis', where)),
      ...(path === undefined ? {} : { path: (path as string).trim() }),
      ...(line === undefined ? {} : { line: line as number }),
    }
  })
  return focus.length === 0 ? {} : { focus }
}

/** Text that came from the requester or a model, made safe to post: it cannot close the block or mention anyone. */
const ZERO_WIDTH_SPACE = String.fromCodePoint(0x200b)
const quiet = (value: string): string =>
  value.replaceAll('<', '&lt;').replaceAll(/@(\w)/gu, `@${ZERO_WIDTH_SPACE}$1`)

function summaryOf(focus: readonly FocusAnswer[]): string {
  const count = (status: FocusStatus) => focus.filter((entry) => entry.status === status).length
  const holds = count('holds')
  const not = count('does_not_hold')
  const unchecked = count('not_checked')
  const parts = [
    ...(holds === 0 ? [] : [`${holds} ok`]),
    ...(not === 0 ? [] : [`${not} problem`]),
    ...(unchecked === 0 ? [] : [`${unchecked} not checked`]),
  ]
  return `Requested checks: ${parts.join(', ')}`
}

const LABEL: Record<FocusStatus, string> = {
  holds: 'ok',
  does_not_hold: 'problem',
  not_checked: 'not checked',
}

/** True for requester points (and older entries with no origin); target checks stay out of posted summaries. */
export const isRequesterFocus = (entry: FocusAnswer): boolean =>
  entry.origin === undefined || entry.origin === 'requester'

/** One collapsed block with a line per requester point; target checks are never listed here. */
export function focusSection(focus: readonly FocusAnswer[] | undefined): string[] {
  const requested = (focus ?? []).filter(isRequesterFocus)
  if (requested.length === 0) return []
  const rows = requested.map((entry) => {
    const line = entry.line === undefined ? '' : `:${entry.line}`
    const where = entry.path === undefined ? '' : ` (\`${entry.path}${line}\`)`
    return `- "${quiet(entry.point)}": ${LABEL[entry.status]}. ${quiet(entry.basis)}${where}`
  })
  return [`<details><summary>${summaryOf(requested)}</summary>\n\n${rows.join('\n')}\n\n</details>`]
}
