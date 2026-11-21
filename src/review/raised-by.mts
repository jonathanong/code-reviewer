import { isRecord, ReviewError } from './finding.mts'

/** Another reviewer who raised the same problem, and the thread where they did. */
export type RaisedBy = { login: string; url: string }

const LOGIN_RE = /^[A-Za-z0-9][A-Za-z0-9-]*(?:\[bot\])?$/u
const URL_RE = /^https:\/\/[^\s()<>[\]]+$/u

/** The optional attribution of a finding; a malformed one fails closed like the other fields. */
export function parseRaisedBy(
  record: Record<string, unknown>,
  where: string,
): RaisedBy | undefined {
  const raw = record.raisedBy
  if (raw === undefined) return undefined
  if (!isRecord(raw)) throw new ReviewError(`${where}.raisedBy must be an object.`)
  const { login, url } = raw
  if (typeof login !== 'string' || !LOGIN_RE.test(login)) {
    throw new ReviewError(`${where}.raisedBy.login must be a user name.`)
  }
  if (typeof url !== 'string' || !URL_RE.test(url)) {
    throw new ReviewError(`${where}.raisedBy.url must be an https link.`)
  }
  return { login, url }
}

/**
 * The visible credit, empty without one. The link text carries no `@`, so naming a reviewer
 * never notifies them.
 */
export function raisedByLine(raisedBy: RaisedBy | undefined): string {
  if (raisedBy === undefined) return ''
  return `\n\nAlso raised by [${raisedBy.login.replace(/\[bot\]$/u, '')}](${raisedBy.url})`
}
