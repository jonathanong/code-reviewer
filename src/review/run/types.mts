import { INT_LIMITS } from '../rules/limits-parse.mts'
import type { StepRan } from '../../harness/runner.mts'
import type { Usage } from '../benchmark/usage.mts'
import type { Finding } from '../finding.mts'
import type { Pillar } from '../pillar-name.mts'

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
  /** The harness and model that ran the step and what it waited on rate limits; absent in an older run. */
  ran?: StepRan
}

/** What the skill-selection call decided, saved as `skills.json`. */
export type SkillChoice = {
  selected: string[]
  /** How many rule skills were offered. */
  available: number
  error?: string
  usage: Usage | null
  ran?: StepRan
}

/** Wall-clock limits for model calls, in milliseconds. */
export const SELECT_TIMEOUT_MS = INT_LIMITS.selectTimeoutSeconds.default * 1000
export const RUN_TIMEOUT_MS = INT_LIMITS.runTimeoutSeconds.default * 1000
export const CONTEXT_DEADLINE_MS = INT_LIMITS.contextDeadlineSeconds.default * 1000
export const REVIEW_MAX_TURNS = 40
