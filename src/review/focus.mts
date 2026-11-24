import { extraPillar } from './pillar-name.mts'
import { isRecord, oneOf, ReviewError, text } from './finding.mts'
import { normalizeSpace } from './answers.mts'

/** The pillar name of the findings the requester-focus step raises. Reserved: a config may not use it. */
export const FOCUS_PILLAR = extraPillar('focus')

export const FOCUS_STATUSES = ['holds', 'does_not_hold', 'not_checked'] as const
export type FocusStatus = (typeof FOCUS_STATUSES)[number]

/** What the focus step found for one point the requester asked to be checked. */
export type FocusAnswer = {
  /** The point as the requester gave it. */
  point: string
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
    const { path, line } = entry
    if (path !== undefined && (typeof path !== 'string' || !isSafePath(path))) {
      throw new ReviewError(`${where}.path must be a short plain file path.`)
    }
    if (line !== undefined && (!Number.isInteger(line) || (line as number) < 1)) {
      throw new ReviewError(`${where}.line must be a positive integer.`)
    }
    return {
      point: sliceChars(normalizeSpace(text(entry, 'point', where)), MAX_FOCUS_CHARS),
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

/** One collapsed block with a line per requested point; empty without any, so a review without a focus is unchanged. */
export function focusSection(focus: readonly FocusAnswer[] | undefined): string[] {
  if (focus === undefined || focus.length === 0) return []
  const rows = focus.map((entry) => {
    const line = entry.line === undefined ? '' : `:${entry.line}`
    const where = entry.path === undefined ? '' : ` (\`${entry.path}${line}\`)`
    return `- "${quiet(entry.point)}": ${LABEL[entry.status]}. ${quiet(entry.basis)}${where}`
  })
  return [`<details><summary>${summaryOf(focus)}</summary>\n\n${rows.join('\n')}\n\n</details>`]
}
