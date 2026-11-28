import { effectiveAuthorRules, type AuthorRule } from './author-rules.mts'
import { trustsRepoConfig } from './grant-settings.mts'
import type { RepoConfig, RepoConfigs } from './rules/config.mts'
import { candidates } from './settings.mts'

/** The values the dispatcher plans with; each list adds to what the dispatcher already knows. */
export type PlanValues = {
  /** Globs of paths that also trigger the security pillar. */
  securityPaths: readonly string[]
  /** Globs of paths that also count as generated. */
  generatedPaths: readonly string[]
  /** Per-author review rules; the first rule naming a login wins. */
  authors: readonly AuthorRule[]
  /** A first review of at most this many reviewable lines, with no security trigger, is light. */
  smallChangeLines: number
  /** Globs of paths that also count as SQL: a small change to one is not light. */
  sqlPaths: readonly string[]
  /** A change to SQL in a source file (not only a SQL path) is reviewed in full. */
  sqlInCode: boolean
  /** A follow-up whose new commits change more than this many lines of source is reviewed in full. */
  followUpSourceLines: number
}

/** A first review of at most this many reviewable lines, with no security trigger path, is light. */
export const SMALL_PR_LINES = 100

/**
 * A follow-up of at most this many changed lines stays light even when it edits source. 40 lines is
 * a review fix or a small tweak; a follow-up above it adds code (a lock, a query, a new branch) that
 * no pillar has read yet, and the light path gave such pushes about 5 turns and missed it.
 */
export const FOLLOW_UP_SOURCE_LINES = 40

export const DEFAULT_PLAN_VALUES: PlanValues = {
  securityPaths: [],
  generatedPaths: [],
  authors: [],
  smallChangeLines: SMALL_PR_LINES,
  sqlPaths: [],
  sqlInCode: true,
  followUpSourceLines: FOLLOW_UP_SOURCE_LINES,
}

/** The values as `settings` shows them: `authors` lists every rule in force, the built-in one included. */
export const planSummary = (values: PlanValues): PlanValues => ({
  ...values,
  authors: effectiveAuthorRules(values.authors),
})

const unique = (lists: readonly (readonly string[] | undefined)[]): string[] => [
  ...new Set(lists.flatMap((list) => list ?? [])),
]

/**
 * The plan values for `owner/name` (or `owner`). The path lists are the union of every layer that
 * sets them (`sqlPaths` too); `smallChangeLines`, `followUpSourceLines` and `sqlInCode` come from the highest layer that sets it. The repository's own
 * file (`target`) always adds `securityPaths`, which only makes a review stricter, and counts for
 * `generatedPaths`, `smallChangeLines`, `followUpSourceLines` and `sqlInCode` only when a machine layer sets `trustRepoConfig`.
 * `authors` comes from machine layers only; the highest layer's rule for a login wins.
 */
export function resolvePlanValues(
  configs: RepoConfigs,
  scope: string,
  target?: RepoConfig,
): PlanValues {
  const trusted = trustsRepoConfig(configs, scope)
  const all = candidates(configs, scope, target).map(([, config]) => config?.plan)
  const granted = candidates(configs, scope, trusted ? target : undefined).map(
    ([, config]) => config?.plan,
  )
  const machine = candidates(configs, scope, undefined).map(([, config]) => config?.plan)
  return {
    securityPaths: unique(all.map((plan) => plan?.securityPaths)),
    generatedPaths: unique(granted.map((plan) => plan?.generatedPaths)),
    authors: machine.flatMap((plan) => plan?.authors ?? []),
    smallChangeLines:
      granted.find((plan) => plan?.smallChangeLines !== undefined)?.smallChangeLines ??
      SMALL_PR_LINES,
    sqlPaths: unique(all.map((plan) => plan?.sqlPaths)),
    sqlInCode: granted.find((plan) => plan?.sqlInCode !== undefined)?.sqlInCode ?? true,
    followUpSourceLines:
      granted.find((plan) => plan?.followUpSourceLines !== undefined)?.followUpSourceLines ??
      FOLLOW_UP_SOURCE_LINES,
  }
}
