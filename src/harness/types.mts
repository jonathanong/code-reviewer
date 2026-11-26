import type { Exec } from '../review/benchmark/exec.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import type { Mode } from '../review/mode.mts'

/** What a headless step may do. Each harness maps these onto its own tool grants and flags. */
export type Capabilities = {
  /** Read files and search them: read, grep, glob. */
  files: boolean
  /** Load installed rule skills. */
  skills: boolean
  /** Hand lookups to a cheap read-only subagent. */
  explorer: boolean
  /** Shell command prefixes the step may run, and nothing else; empty means no shell. */
  shell: readonly string[]
  /** Hosts the step may fetch web pages from, and nothing else; empty means no web access. */
  web: readonly string[]
}

/** The depth of reasoning a step asks for. */
export type RunEffort = 'low' | 'medium'

/** Every level a benchmark may request of the pillar agent (`max` is not allowed); a review uses only `RunEffort`. */
export const BENCH_EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const
export type BenchEffort = (typeof BENCH_EFFORTS)[number]

/** The effort for a plan's mode. The plan's own `effort` is separate. */
export const EFFORT: Record<Exclude<Mode, 'skip'>, RunEffort> = {
  light: 'low',
  full: 'medium',
}

/** One headless step: a prompt answered with JSON under a set of capabilities. */
export type HarnessRun = {
  prompt: string
  /** Names the step in errors, such as "Pillar run". */
  label: string
  model: string
  maxTurns: number
  /** The JSON the step must return. */
  schema: object
  can: Capabilities
  cwd?: string
  timeoutMs?: number
  /** Added to this process's environment for the step only. */
  env?: Record<string, string>
  effort?: BenchEffort
  /** Directories outside `cwd` the step may read. */
  addDirs?: readonly string[]
  /** The `pluginSettings` object limiting the step to the rule plugins; opaque to callers. */
  settings?: object
  /** The machine config accepts that this candidate's harness may read outside the checkout and run directory. */
  readsOutsideCheckout?: boolean
  /**
   * Every host the review's configured references allow, whatever this step may use (`can.web`).
   * A harness that confines the network with an allowlist (agy) allows these on every step.
   */
  referenceDomains?: readonly string[]
  /** Read the step's transcript, so the result lists the skills it loaded. */
  transcript?: boolean
}

export type HarnessResult = {
  /** The JSON the step returned; undefined when it returned none. */
  structured: unknown
  /** Distinct skills the step loaded; always empty without `transcript`. */
  skills: string[]
  /** Distinct files the step read, as the model named them; always empty without `transcript`. */
  reads: string[]
  /** Distinct Grep and Glob patterns the step ran; always empty without `transcript`. */
  searches: string[]
  usage: Usage
  /** The usage the step itself reported at its end; null when it reported none. A step that rejects the answer records this. */
  reportedUsage: Usage | null
}

/** One harness and the model it runs; a step tries its candidates in order. */
export type Candidate = { harness: string; model: string; readsOutsideCheckout?: true }

/**
 * Why a run failed, as far as the harness can tell. `rate_limited` and `overloaded` are worth
 * waiting out; `auth` is worth a different harness; anything not recognized is `other` and is
 * never retried.
 */
export type FailureClass =
  | { kind: 'rate_limited'; retryAfterSeconds?: number }
  | { kind: 'overloaded' }
  | { kind: 'auth' }
  | { kind: 'other' }

export type Harness = {
  name: string
  /** Rejects with whatever `exec` rejects with, and when the output holds no JSON. */
  run(request: HarnessRun, exec: Exec): Promise<HarnessResult>
  /** Throws a `HarnessRefusal` when the request asks for what the adapter cannot confine; absent when it refuses nothing. */
  assertCan?(request: HarnessRun): void
  /** The message and usage to record for a step that rejected, keeping what a failed run still reported. */
  describeFailure(error: unknown): { message: string; usage: Usage | null }
  /** Classifies what `run` rejected with; `other` when the shape is not one the harness knows. */
  classifyFailure(error: unknown): FailureClass
}

/** Reads and searches files only. */
export const READ_ONLY: Capabilities = {
  files: true,
  skills: false,
  explorer: false,
  shell: [],
  web: [],
}

/** No tools at all. */
export const NO_TOOLS: Capabilities = { ...READ_ONLY, files: false }
