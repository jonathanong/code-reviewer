import { isRecord, unknownKeys } from './settings-parse.mts'

/** The `limits` key: ceilings a review may not pass. */
export type LimitsConfig = {
  /** Total cost in US dollars after which no further step starts. */
  maxCostUsd?: number
}

/** A ceiling as a flag or a config file gives it: a finite number above zero. */
export const isCeiling = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

/** The `limits` key. A key with any problem is ignored whole, so a typo cannot quietly lift a ceiling. */
export function parseLimits(
  raw: unknown,
  where: string,
  problems: string[],
): LimitsConfig | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) {
    problems.push(`${where}: must be an object; ignored`)
    return undefined
  }
  const found = unknownKeys(raw, ['maxCostUsd'], where)
  if (raw.maxCostUsd !== undefined && !isCeiling(raw.maxCostUsd)) {
    found.push(`${where}.maxCostUsd: must be a number greater than 0`)
  }
  if (found.length > 0) {
    problems.push(...found.map((problem) => `${problem}; limits ignored`))
    return undefined
  }
  return raw.maxCostUsd === undefined ? {} : { maxCostUsd: raw.maxCostUsd as number }
}
