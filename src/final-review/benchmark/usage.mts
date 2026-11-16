import { ExecError } from './exec.mts'
import { isObject, jsonEvents } from './stream-json.mts'

/** One model's share of a run: the main model and every subagent model are listed separately. */
export type ModelUsage = {
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  costUsd: number | null
}

/** Cost and size of one `claude -p` run; a field is null when the result event lacks it. */
export type Usage = {
  costUsd: number | null
  turns: number | null
  durationMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  cacheReadTokens: number | null
  cacheCreationTokens: number | null
  /** Per model id, from the result's `modelUsage`; `{}` when absent. Results saved earlier have none. */
  byModel: Record<string, ModelUsage>
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

/** The final `result` event of a run, which carries `subtype`, cost, turns, and token counts. */
export function resultEvent(stdout: string): Record<string, unknown> | undefined {
  return jsonEvents(stdout).findLast((event) => event.type === 'result')
}

function parseModels(value: unknown): Record<string, ModelUsage> {
  if (!isObject(value) || Array.isArray(value)) return {}
  return Object.fromEntries(
    Object.entries(value).flatMap(([model, entry]) =>
      isObject(entry)
        ? [
            [
              model,
              {
                inputTokens: count(entry.inputTokens),
                outputTokens: count(entry.outputTokens),
                cacheReadTokens: count(entry.cacheReadInputTokens),
                cacheCreationTokens: count(entry.cacheCreationInputTokens),
                costUsd: count(entry.costUSD),
              },
            ],
          ]
        : [],
    ),
  )
}

/** Reads usage from a result event, tolerating missing or malformed fields. */
export function parseUsage(event: Record<string, unknown> | undefined): Usage {
  const tokens = isObject(event?.usage) ? event.usage : {}
  return {
    costUsd: count(event?.total_cost_usd),
    turns: count(event?.num_turns),
    durationMs: count(event?.duration_ms),
    inputTokens: count(tokens.input_tokens),
    outputTokens: count(tokens.output_tokens),
    cacheReadTokens: count(tokens.cache_read_input_tokens),
    cacheCreationTokens: count(tokens.cache_creation_input_tokens),
    byModel: parseModels(event?.modelUsage),
  }
}

/**
 * The message and usage to record for a failed run. A non-zero `claude` exit that still printed a
 * result event keeps that event's subtype, so `error_max_turns` is told apart from a crash.
 */
export function describeFailure(error: unknown): { message: string; usage: Usage | null } {
  if (!(error instanceof ExecError)) {
    return { message: error instanceof Error ? error.message : String(error), usage: null }
  }
  const event = resultEvent(error.stdout)
  if (event === undefined) return { message: error.message, usage: null }
  const [first = '', ...rest] = error.message.split('\n')
  const subtype = typeof event.subtype === 'string' ? ` (${event.subtype})` : ''
  return { message: [`${first}${subtype}`, ...rest].join('\n'), usage: parseUsage(event) }
}
