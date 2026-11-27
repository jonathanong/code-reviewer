import { isRecord, parseSwitch, unknownKeys } from './settings-parse.mts'

/** The `requestFocus` key. Absent means a review request's text is never read for points to check. */
export type RequestFocusConfig = { enabled: boolean }

/** The `requestFocus` key; one with any problem is ignored whole, which leaves it off. */
export function parseRequestFocus(
  raw: unknown,
  where: string,
  problems: string[],
): RequestFocusConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  const found = unknownKeys(raw, ['enabled'], where)
  const enabled = parseSwitch(raw.enabled, `${where}.enabled`, found)
  if (raw.enabled === undefined) found.push(`${where}.enabled: is required`)
  if (found.length > 0 || enabled === undefined) {
    problems.push(...found.map((problem) => `${problem}; requestFocus ignored`))
    return undefined
  }
  return { enabled }
}
