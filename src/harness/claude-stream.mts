import { ReviewError } from '../review/finding.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import type { HarnessResult } from './types.mts'
import { parseUsage, resultEvent } from './claude-usage.mts'
import { isObject, jsonEvents, jsonLines } from './json.mts'

type Part = {
  type?: unknown
  name?: unknown
  id?: unknown
  input?: { skill?: unknown }
  tool_use_id?: unknown
  is_error?: unknown
}

/**
 * Distinct skills a stream-json run loaded, in first-use order: each `Skill` tool_use whose
 * tool_result came back without an error. A request that failed or got no result does not count.
 */
function loadedSkills(events: readonly Record<string, unknown>[]): string[] {
  const requested = new Map<unknown, string>()
  const succeeded = new Set<unknown>()
  for (const event of events) {
    const content = (event.message as { content?: unknown } | undefined)?.content
    if (!Array.isArray(content)) continue
    for (const part of content as Part[]) {
      const skill = part?.input?.skill
      if (event.type === 'assistant' && part?.type === 'tool_use' && part.name === 'Skill') {
        if (typeof skill === 'string') requested.set(part.id, skill)
      } else if (event.type === 'user' && part?.type === 'tool_result' && part.is_error !== true) {
        succeeded.add(part.tool_use_id)
      }
    }
  }
  const loaded = [...requested].filter(([id]) => succeeded.has(id)).map(([, skill]) => skill)
  return [...new Set(loaded)]
}

export type RunStream = {
  /** `structured_output` of the last event that has one; undefined when none does. */
  structured: unknown
  skills: string[]
  usage: Usage
}

/**
 * Reads a `claude -p --output-format stream-json --verbose` run (JSONL; one `--output-format
 * json` object works too). With a subagent the stream can hold several `result` events, an early
 * one while the subagent still runs, so the answer is the last event that carries structured
 * output and the usage is the last result event.
 */
export function readStream(stdout: string, what: string): RunStream {
  if (jsonLines(stdout).length === 0) throw new ReviewError(`${what} did not print JSON.`)
  const events = jsonEvents(stdout)
  const answer = events.findLast((event) => isObject(event.structured_output))
  const final = events.findLast((event) => event.type === 'result') ?? answer
  return {
    structured: answer?.structured_output,
    skills: loadedSkills(events),
    usage: parseUsage(final),
  }
}

/** A `stream-json` run: the stream's answer and skills, and what its last result event reported. */
export function readTranscript(stdout: string, what: string): HarnessResult {
  const stream = readStream(stdout, what)
  const event = resultEvent(stdout)
  return { ...stream, reportedUsage: event === undefined ? null : parseUsage(event) }
}

/** One `--output-format json` object: the answer is its `structured_output`. */
export function readResult(stdout: string): HarnessResult {
  const parsed = JSON.parse(stdout) as { structured_output?: unknown } | null
  const usage = parseUsage(resultEvent(stdout))
  return { structured: parsed?.structured_output, skills: [], usage, reportedUsage: usage }
}
