import type { Usage } from '../benchmark/usage.mts'
import type { Finding, Pillar } from '../finding.mts'

/** Per-attempt cost of a pillar run that failed before it produced findings. */
export type FailedAttempt = { error: string; usage: Usage | null }

/** One pillar's outcome, saved as `pillars/<pillar>.json`. `error` is set when it never answered. */
export type PillarResult = {
  pillar: Pillar
  model: string
  skills: string[]
  findings: Finding[]
  usage: Usage | null
  error?: string
  failedAttempts: FailedAttempt[]
}

/** What the skill-selection call decided, saved as `skills.json`. */
export type SkillChoice = {
  selected: string[]
  /** How many rule skills were offered. */
  available: number
  error?: string
  usage: Usage | null
}

/** Wall-clock limits for model calls, in milliseconds. */
export const SELECT_TIMEOUT_MS = 2 * 60 * 1000
export const RUN_TIMEOUT_MS = 30 * 60 * 1000
export const REVIEW_MAX_TURNS = 40
