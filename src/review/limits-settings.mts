import {
  DEFAULT_MAX_COST_USD,
  INT_LIMITS,
  isCeiling,
  type LimitsConfig,
} from './rules/limits-parse.mts'
import type { RepoConfigs } from './rules/config.mts'
import { candidates, type MachineLayer } from './settings.mts'

export type LimitSettings = {
  /** The most a review may cost in US dollars before no further step starts. */
  maxCostUsd: number
  /** The machine layer that sets `maxCostUsd`; null when it is the built-in default. */
  maxCostFrom: MachineLayer
  /** Seconds a model run may take; the built-in value when no layer sets it. */
  runTimeoutSeconds: number
  selectTimeoutSeconds: number
  contextDeadlineSeconds: number
  /** Pillars that run at once when `--jobs` is absent. */
  pillarJobs: number
  /** The machine layer whose `limits` key applies; null when none sets it. */
  from: MachineLayer
}

/**
 * The limits for `owner/name` (or `owner`), key by key: each key takes the value of the highest
 * machine layer that sets that key, so a narrower file that sets one key keeps the wider file's
 * other keys, a ceiling included. The reviewed repository's own file is never consulted, so it
 * cannot lift the ceiling.
 */
export function resolveLimits(configs: RepoConfigs, scope: string): LimitSettings {
  const layers = candidates(configs, scope, undefined).flatMap(([layer, config]) =>
    config?.limits === undefined || layer === 'repository file'
      ? []
      : [{ layer, limits: config.limits }],
  )
  const pick = <K extends keyof LimitsConfig>(key: K): LimitsConfig[K] | undefined =>
    layers.find(({ limits }) => limits[key] !== undefined)?.limits[key]
  return {
    maxCostUsd: pick('maxCostUsd') ?? DEFAULT_MAX_COST_USD,
    maxCostFrom: layers.find(({ limits }) => limits.maxCostUsd !== undefined)?.layer ?? null,
    runTimeoutSeconds: pick('runTimeoutSeconds') ?? INT_LIMITS.runTimeoutSeconds.default,
    selectTimeoutSeconds: pick('selectTimeoutSeconds') ?? INT_LIMITS.selectTimeoutSeconds.default,
    contextDeadlineSeconds:
      pick('contextDeadlineSeconds') ?? INT_LIMITS.contextDeadlineSeconds.default,
    pillarJobs: pick('pillarJobs') ?? INT_LIMITS.pillarJobs.default,
    from: layers.find(({ limits }) => Object.keys(limits).length > 0)?.layer ?? null,
  }
}

/** The config problems about `limits` in the machine files of this repository or its owner. */
export function limitsProblems(configs: RepoConfigs, repo: string): string[] {
  const lower = repo.toLowerCase()
  const owner = lower.split('/')[0] as string
  return configs.problems.filter((problem) => {
    const text = problem.toLowerCase()
    return (
      (text.startsWith(`${owner}.`) || text.startsWith(`${lower}.`)) && /\blimits\b/u.test(text)
    )
  })
}

/** The limits a review runs with; throws on a bad `limits` value, so a ceiling is never dropped silently. */
export function requireLimits(configs: RepoConfigs, repo: string): LimitSettings {
  const problems = limitsProblems(configs, repo)
  if (problems.length > 0) throw new Error(`settings invalid: ${problems.join('; ')}`)
  return resolveLimits(configs, repo)
}

/** `--max-cost USD`: a number above zero. Throws a message fit for a usage error. */
export function parseMaxCost(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const usd = value.trim() === '' ? Number.NaN : Number(value)
  if (!isCeiling(usd)) throw new Error('--max-cost must be a number of US dollars greater than 0.')
  return usd
}
