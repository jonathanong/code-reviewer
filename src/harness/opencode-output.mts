import { ExecError } from '../review/benchmark/exec.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import { ReviewError } from '../review/finding.mts'
import { isObject, jsonEvents } from './json.mts'
import type { HarnessResult, HarnessRun } from './types.mts'

type Events = Record<string, unknown>[]

const FENCE = /^```(?:json)?[ \t]*\n([\s\S]*?)\n?```$/u

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0)

/** Usage summed over every `step_finish` event; a turn is one such event. */
function sumUsage(events: Events, model: string): Usage {
  const finished = events.filter((event) => event.type === 'step_finish')
  const parts = finished.map((event) => (isObject(event.part) ? event.part : {}))
  const tokens = parts.map((part) => (isObject(part.tokens) ? part.tokens : {}))
  const caches = tokens.map((entry) => (isObject(entry.cache) ? entry.cache : {}))
  const used = {
    inputTokens: sum(tokens.map((entry) => count(entry.input))),
    outputTokens: sum(tokens.map((entry) => count(entry.output))),
    cacheReadTokens: sum(caches.map((entry) => count(entry.read))),
    cacheCreationTokens: sum(caches.map((entry) => count(entry.write))),
    costUsd: sum(parts.map((part) => count(part.cost))),
  }
  return { ...used, turns: finished.length, durationMs: null, byModel: { [model]: used } }
}

/** The text of every text event after the last `step_start`: the model's final answer. */
function finalText(events: Events): string {
  const start = events.findLastIndex((event) => event.type === 'step_start')
  return events
    .slice(start + 1)
    .flatMap((event) =>
      event.type === 'text' && isObject(event.part) && typeof event.part.text === 'string'
        ? [event.part.text]
        : [],
    )
    .join('')
}

function parseReply(text: string): unknown {
  const trimmed = text.trim()
  const fenced = FENCE.exec(trimmed)
  try {
    return JSON.parse(fenced?.[1] ?? trimmed)
  } catch {
    return undefined
  }
}

/** True for an object holding every key the schema's top level requires. */
function matchesRequired(value: unknown, schema: object): value is Record<string, unknown> {
  if (!isObject(value) || Array.isArray(value)) return false
  const required = 'required' in schema && Array.isArray(schema.required) ? schema.required : []
  return required.every((key) => typeof key === 'string' && key in value)
}

/** The message of the first `error` event, undefined when there is none. */
function errorMessage(events: Events): string | undefined {
  for (const event of events) {
    if (event.type !== 'error' || !isObject(event.error)) continue
    const data = event.error.data
    if (isObject(data) && typeof data.message === 'string') return data.message
  }
  return undefined
}

/** Reads the JSONL events `opencode run --format json` prints; its answer is the final text. */
export function readOpencodeResult(stdout: string, request: HarnessRun): HarnessResult {
  const events = jsonEvents(stdout)
  const failure = errorMessage(events)
  if (failure !== undefined) throw new ReviewError(`${request.label} failed: ${failure}`)
  const text = finalText(events)
  if (text.trim() === '') throw new ReviewError(`${request.label} printed no text.`)
  const structured = parseReply(text)
  if (!matchesRequired(structured, request.schema)) {
    throw new ReviewError(`${request.label} did not reply with the JSON its schema requires.`)
  }
  const usage = sumUsage(events, request.model)
  return { structured, skills: [], usage, reportedUsage: usage }
}

/** The message to record for a failed run; a non-zero exit keeps the error event OpenCode printed. */
export function describeOpencodeFailure(error: unknown): { message: string; usage: Usage | null } {
  if (!(error instanceof ExecError)) {
    return { message: error instanceof Error ? error.message : String(error), usage: null }
  }
  const message = errorMessage(jsonEvents(error.stdout))
  if (message === undefined) return { message: error.message, usage: null }
  const [first = ''] = error.message.split('\n')
  return { message: `${first}: ${message}`, usage: null }
}
