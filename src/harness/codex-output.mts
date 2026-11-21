import { ExecError } from '../review/benchmark/exec.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import { ReviewError } from '../review/finding.mts'
import { isObject, jsonEvents } from './json.mts'

type Events = Record<string, unknown>[]

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

/** Usage summed over every `turn.completed` event; a turn is one such event. Codex reports no cost. */
export function codexUsage(stdout: string, model: string): Usage {
  const turns = jsonEvents(stdout).filter((event) => event.type === 'turn.completed')
  const tokens = turns.map((event) => (isObject(event.usage) ? event.usage : {}))
  const sum = (key: string) => tokens.reduce((total, entry) => total + count(entry[key]), 0)
  const used = {
    inputTokens: sum('input_tokens'),
    outputTokens: sum('output_tokens'),
    cacheReadTokens: sum('cached_input_tokens'),
    cacheCreationTokens: null,
    costUsd: null,
  }
  return { ...used, turns: turns.length, durationMs: null, byModel: { [model]: used } }
}

/** The message of the first `error` or `turn.failed` event, undefined when there is none. */
export function codexErrorMessage(events: Events): string | undefined {
  for (const event of events) {
    if (event.type === 'error' && typeof event.message === 'string') return event.message
    if (event.type === 'turn.failed' && isObject(event.error)) {
      if (typeof event.error.message === 'string') return event.error.message
    }
  }
  return undefined
}

/** The answer in the file `-o` wrote; an error event, or a missing or non-JSON answer, rejects. */
export function readCodexAnswer(stdout: string, lastMessage: string, what: string): unknown {
  const failure = codexErrorMessage(jsonEvents(stdout))
  if (failure !== undefined) throw new ReviewError(`${what} failed: ${failure}`)
  try {
    return JSON.parse(lastMessage)
  } catch (error) {
    throw new ReviewError(`${what} did not reply with JSON.`, { cause: error })
  }
}

/** The message to record for a failed run; a non-zero exit keeps the error event Codex printed. */
export function describeCodexFailure(error: unknown): { message: string; usage: Usage | null } {
  if (!(error instanceof ExecError)) {
    return { message: error instanceof Error ? error.message : String(error), usage: null }
  }
  const message = codexErrorMessage(jsonEvents(error.stdout))
  if (message === undefined) return { message: error.message, usage: null }
  const [first = ''] = error.message.split('\n')
  return { message: `${first}: ${message}`, usage: null }
}
