import { ExecError } from '../review/benchmark/exec.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import { ReviewError } from '../review/finding.mts'
import { isObject } from './json.mts'
import type { HarnessResult } from './types.mts'

const FENCE = /^```(?:json)?[ \t]*\n([\s\S]*?)\n?```$/u
/** The keys agy's result object may hold the answer under, in order: structured output, then reply text. */
const ANSWER_KEYS = [
  'structuredOutput',
  'structured_output',
  'result',
  'response',
  'text',
  'output',
]

const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const sum = (a: number | null, b: number | null) =>
  a === null && b === null ? null : (a ?? 0) + (b ?? 0)

/** The actions headless mode auto-denied, as `Bash` or `command`, from `denied_actions`. */
function deniedActions(parsed: Record<string, unknown>): string[] {
  const { denied_actions: denied } = parsed
  if (!Array.isArray(denied)) return []
  return denied.map((entry: unknown) => {
    if (!isObject(entry)) return 'an action'
    const name = entry.display_name ?? entry.action
    return typeof name === 'string' ? name : 'an action'
  })
}

function parseObject(stdout: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stdout)
    return isObject(parsed) && !Array.isArray(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

/** The error text of a result that carries one: an `error` string or object, or `type: "error"`. */
function errorMessage(parsed: Record<string, unknown> | undefined): string | undefined {
  if (parsed === undefined) return undefined
  const { error } = parsed
  if (typeof error === 'string') return error
  if (isObject(error) && typeof error.message === 'string') return error.message
  return parsed.type === 'error' && typeof parsed.message === 'string' ? parsed.message : undefined
}

/** The first answer key holding a JSON object, or a string holding one (optionally fenced). */
function structuredFrom(parsed: Record<string, unknown>): unknown {
  for (const key of ANSWER_KEYS) {
    const value = parsed[key]
    if (isObject(value) && !Array.isArray(value)) return value
    if (typeof value !== 'string') continue
    const text = value.trim()
    const reply = parseObject(FENCE.exec(text)?.[1] ?? text)
    if (reply !== undefined) return reply
  }
  return undefined
}

/** Reads usage from agy's `usage` object when it has one; every field is null otherwise. */
function parseAgyUsage(parsed: Record<string, unknown>): Usage {
  const tokens = isObject(parsed.usage) ? parsed.usage : {}
  return {
    costUsd: count(parsed.total_cost_usd),
    turns: count(parsed.num_turns),
    durationMs: null,
    inputTokens: count(tokens.input_tokens),
    outputTokens: sum(count(tokens.output_tokens), count(tokens.thinking_tokens)),
    cacheReadTokens: count(tokens.cache_read_tokens),
    cacheCreationTokens: count(tokens.cache_creation_input_tokens),
    byModel: {},
  }
}

/**
 * Reads the one JSON object `agy -p --output-format json` prints. Its shape is not documented,
 * so the answer is the structured output when the object has one, else the JSON the reply text
 * holds; an answer that is neither is left undefined for the caller to reject.
 */
export function readAgyResult(stdout: string, what: string): HarnessResult {
  const parsed = parseObject(stdout)
  if (parsed === undefined) throw new ReviewError(`${what} did not print JSON.`)
  const message = errorMessage(parsed)
  if (message !== undefined) throw new ReviewError(`${what} failed: ${message}`)
  const usage = parseAgyUsage(parsed)
  const structured = structuredFrom(parsed)
  const denied = deniedActions(parsed)
  if (structured === undefined && denied.length > 0) {
    throw new ReviewError(
      `${what} failed: agy denied ${denied.join(', ')}: headless mode cannot approve it.`,
    )
  }
  return {
    structured,
    skills: [],
    reads: [],
    searches: [],
    usage,
    reportedUsage: usage,
  }
}

/** The message to record for a failed run; a non-zero exit keeps the error agy printed. */
export function describeAgyFailure(error: unknown): { message: string; usage: Usage | null } {
  if (!(error instanceof ExecError)) {
    return { message: error instanceof Error ? error.message : String(error), usage: null }
  }
  const message = errorMessage(parseObject(error.stdout))
  if (message === undefined) return { message: error.message, usage: null }
  const [first = ''] = error.message.split('\n')
  return { message: `${first}: ${message}`, usage: null }
}
