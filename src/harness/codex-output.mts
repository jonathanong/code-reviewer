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
  const reported = tokens.some((entry) => 'cache_write_input_tokens' in entry)
  const used = {
    inputTokens: sum('input_tokens'),
    outputTokens: sum('output_tokens'),
    cacheReadTokens: sum('cached_input_tokens'),
    cacheCreationTokens: reported ? sum('cache_write_input_tokens') : null,
    costUsd: null,
  }
  return { ...used, turns: turns.length, durationMs: null, byModel: { [model]: used } }
}

/**
 * The message of the first `error` or `turn.failed` event after the last `turn.completed`,
 * undefined when there is none: an error that a later completed turn followed was recovered from.
 */
export function codexErrorMessage(events: Events): string | undefined {
  const done = events.findLastIndex((event) => event.type === 'turn.completed')
  for (const event of events.slice(done + 1)) {
    if (event.type === 'error' && typeof event.message === 'string') return event.message
    if (event.type === 'turn.failed' && isObject(event.error)) {
      if (typeof event.error.message === 'string') return event.error.message
    }
  }
  return undefined
}

/** A rejected answer, keeping the usage of the turns that did complete. */
export class CodexAnswerError extends ReviewError {
  readonly usage: Usage | null

  constructor(message: string, usage: Usage | null, options?: ErrorOptions) {
    super(message, options)
    this.usage = usage
  }
}

/**
 * The answer in the file `-o` wrote. An error event that no completed turn followed, or a missing
 * or non-JSON answer, rejects with the usage the completed turns reported, null when none did.
 */
export function readCodexAnswer(
  stdout: string,
  lastMessage: string,
  what: string,
  usage: Usage,
): unknown {
  const spent = usage.turns === 0 ? null : usage
  const failure = codexErrorMessage(jsonEvents(stdout))
  if (failure !== undefined) throw new CodexAnswerError(`${what} failed: ${failure}`, spent)
  try {
    return JSON.parse(lastMessage)
  } catch (error) {
    throw new CodexAnswerError(`${what} did not reply with JSON.`, spent, { cause: error })
  }
}

/** The message to record for a failed run; a non-zero exit keeps the error event Codex printed. */
export function describeCodexFailure(error: unknown): { message: string; usage: Usage | null } {
  if (error instanceof CodexAnswerError) return { message: error.message, usage: error.usage }
  if (!(error instanceof ExecError)) {
    return { message: error instanceof Error ? error.message : String(error), usage: null }
  }
  const message = codexErrorMessage(jsonEvents(error.stdout))
  if (message === undefined) return { message: error.message, usage: null }
  const [first = ''] = error.message.split('\n')
  return { message: `${first}: ${message}`, usage: null }
}
