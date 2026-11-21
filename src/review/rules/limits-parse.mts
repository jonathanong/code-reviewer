import { isRecord, unknownKeys } from './settings-parse.mts'

/** The `limits` key: ceilings a review may not pass. */
export type LimitsConfig = {
  /** Total cost in US dollars after which no further step starts. */
  maxCostUsd?: number
  /** Seconds one pillar, verifier, evidence or approval-check run may take. */
  runTimeoutSeconds?: number
  /** Seconds the skill-selection call may take. */
  selectTimeoutSeconds?: number
  /** Seconds the whole context build may take before the review goes on without it. */
  contextDeadlineSeconds?: number
  /** Pillars that run at once; `--jobs` beats it. */
  pillarJobs?: number
}

/** The cost ceiling a review has when no config or `--max-cost` sets one, in US dollars. */
export const DEFAULT_MAX_COST_USD = 25

type IntKey = 'runTimeoutSeconds' | 'selectTimeoutSeconds' | 'contextDeadlineSeconds' | 'pillarJobs'

/** Each whole-number limit: its built-in value and the range a config may choose from. */
export const INT_LIMITS: Record<IntKey, { default: number; min: number; max: number }> = {
  runTimeoutSeconds: { default: 1800, min: 60, max: 14_400 },
  selectTimeoutSeconds: { default: 120, min: 10, max: 1800 },
  contextDeadlineSeconds: { default: 60, min: 5, max: 600 },
  pillarJobs: { default: 3, min: 1, max: 16 },
}

const INT_KEYS = Object.keys(INT_LIMITS) as IntKey[]

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
  const found = unknownKeys(raw, ['maxCostUsd', ...INT_KEYS], where)
  if (raw.maxCostUsd !== undefined && !isCeiling(raw.maxCostUsd)) {
    found.push(`${where}.maxCostUsd: must be a number greater than 0`)
  }
  for (const key of INT_KEYS) {
    const { min, max } = INT_LIMITS[key]
    const value = raw[key]
    if (
      value !== undefined &&
      !(Number.isInteger(value) && (value as number) >= min && (value as number) <= max)
    ) {
      found.push(`${where}.${key}: must be an integer from ${min} to ${max}`)
    }
  }
  if (found.length > 0) {
    problems.push(...found.map((problem) => `${problem}; limits ignored`))
    return undefined
  }
  return {
    ...(raw.maxCostUsd === undefined ? {} : { maxCostUsd: raw.maxCostUsd as number }),
    ...Object.fromEntries(
      INT_KEYS.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]),
    ),
  }
}
