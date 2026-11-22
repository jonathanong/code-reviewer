import { ExecError } from '../review/benchmark/exec.mts'
import type { ModelUsage, Usage } from '../review/benchmark/usage.mts'
import { ReviewError } from '../review/finding.mts'
import { isObject } from './json.mts'
import type { HarnessResult } from './types.mts'

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
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

/** Reads usage from a Grok result object, tolerating missing or malformed fields. */
export function parseGrokUsage(result: Record<string, unknown>): Usage {
  const tokens = isObject(result.usage) ? result.usage : {}
  return {
    costUsd: count(result.total_cost_usd),
    turns: count(result.num_turns),
    durationMs: null,
    inputTokens: count(tokens.input_tokens),
    outputTokens: count(tokens.output_tokens),
    cacheReadTokens: count(tokens.cache_read_input_tokens),
    cacheCreationTokens: count(tokens.cache_creation_input_tokens),
    byModel: parseModels(result.modelUsage),
  }
}

function parseObject(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    return isObject(parsed) && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The message of a `{"type":"error","message":"..."}` object, undefined for anything else. */
function errorMessage(parsed: Record<string, unknown> | undefined): string | undefined {
  return parsed?.type === 'error' && typeof parsed.message === 'string' ? parsed.message : undefined
}

/** Reads the one JSON object `grok --output-format json` prints; its answer is `structuredOutput`. */
export function readGrokResult(stdout: string, what: string): HarnessResult {
  const parsed = parseObject(stdout)
  if (parsed === undefined) throw new ReviewError(`${what} did not print JSON.`)
  const message = errorMessage(parsed)
  if (message !== undefined) throw new ReviewError(`${what} failed: ${message}`)
  const usage = parseGrokUsage(parsed)
  return {
    structured: parsed.structuredOutput,
    skills: [],
    reads: [],
    searches: [],
    usage,
    reportedUsage: usage,
  }
}

/** The message to record for a failed run; a non-zero exit keeps the error object Grok printed. */
export function describeGrokFailure(error: unknown): { message: string; usage: Usage | null } {
  if (!(error instanceof ExecError)) {
    return { message: error instanceof Error ? error.message : String(error), usage: null }
  }
  const message = errorMessage(parseObject(error.stdout))
  if (message === undefined) return { message: error.message, usage: null }
  const [first = ''] = error.message.split('\n')
  return { message: `${first}: ${message}`, usage: null }
}
