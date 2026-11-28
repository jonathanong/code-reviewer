import type { Exec } from '../review/benchmark/exec.mts'

/** The one hook-harness version `wait` runs; bump it here only. */
export const HOOK_HARNESS = 'hook-harness@0.4.0'

/** One event as hook-harness prints it, reduced to the fields `wait` reads. */
export type HarnessEvent = {
  repo?: string
  prs?: number[]
  event?: string
  action?: string
  /** Set for an issue (not a pull request). */
  issue?: unknown
  sender?: { login?: string }
  /** The label a label event added. */
  label?: string
  headSha?: string | null
  payload?: {
    comment?: {
      id?: number
      in_reply_to_id?: number | null
      user?: { login?: string }
    }
  }
}

export type HarnessResult = {
  events: HarnessEvent[]
  gap: boolean
  cursor: string
  timedOut?: boolean
}

/** What one hook-harness wait is asked for. */
export type HarnessCall = {
  owners: string[]
  /** The request labels to wake on. */
  labels: string[]
  /** Senders whose review-comment events are dropped by hook-harness itself. */
  ignoreSenders: string[]
  timeoutSeconds: number
  after: string | undefined
}

export type Harness = (call: HarnessCall) => Promise<HarnessResult>

export function harnessArgs(call: HarnessCall): string[] {
  return [
    '-y',
    HOOK_HARNESS,
    'wait',
    '--owner',
    call.owners.join(','),
    ...call.labels.flatMap((label) => ['--on', `label:${label}`]),
    '--filter',
    JSON.stringify({
      event: 'pull_request_review_comment',
      action: 'created',
      ignoreSenders: call.ignoreSenders,
    }),
    '--timeout',
    `${call.timeoutSeconds}s`,
    ...(call.after === undefined ? [] : ['--after', call.after]),
  ]
}

/** Reads the one JSON object hook-harness prints; anything else is a failure. */
export function parseHarnessResult(text: string): HarnessResult {
  const parsed = JSON.parse(text) as Partial<HarnessResult>
  if (!Array.isArray(parsed.events) || typeof parsed.cursor !== 'string') {
    throw new Error('hook-harness printed no events and cursor')
  }
  return {
    events: parsed.events,
    gap: parsed.gap === true,
    cursor: parsed.cursor,
    ...(parsed.timedOut === true ? { timedOut: true } : {}),
  }
}

/** The default harness: `npx -y hook-harness@<pin> wait`, which prints its result as one JSON line. */
export function createHarness(exec: Exec): Harness {
  return async (call) =>
    parseHarnessResult(
      await exec('npx', harnessArgs(call), { timeoutMs: (call.timeoutSeconds + 120) * 1000 }),
    )
}
