/** One file of a probe's synthetic tree. */
export type ProbeFile = { path: string; content: string }

/** A tiny synthetic file tree with one planted defect, and the prompt that asks for findings. */
export type Probe = {
  name: string
  prompt: string
  files: ProbeFile[]
  /** Where the defect is; a finding on this file within two lines of this line is a hit. */
  planted: { path: string; line: number }
}

/** What one probe run came to. */
export type RunRecord = {
  valid: boolean
  found: boolean
  /** Findings other than the one on the planted line; 0 when the run was not valid. */
  extra: number
  seconds: number
  tokens: number | null
  costUsd: number | null
  rateLimited: boolean
  /** One line, set for a run that failed. */
  failure?: string
}

/** One model's measurements over all its runs. Shares are null when no run could be scored. */
export type ModelStats = {
  id: string
  runs: number
  valid: number | null
  found: number | null
  extra: number | null
  seconds: number | null
  tokens: number | null
  costUsd: number | null
  rateLimited: number
  failures: string[]
}

export type ModelsReport = { harness: string; models: ModelStats[] }
