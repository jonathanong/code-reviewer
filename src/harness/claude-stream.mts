import { ReviewError } from '../review/finding.mts'
import type { Usage } from '../review/benchmark/usage.mts'
import type { HarnessResult } from './types.mts'
import { parseUsage, resultEvent } from './claude-usage.mts'
import { isObject, jsonEvents, jsonLines } from './json.mts'

type Part = {
  type?: unknown
  name?: unknown
  id?: unknown
  input?: {
    skill?: unknown
    file_path?: unknown
    pattern?: unknown
    path?: unknown
    glob?: unknown
  }
  tool_use_id?: unknown
  is_error?: unknown
}

type Use = { kind: 'skills' | 'reads' | 'searches'; value: string }

function searchLabel(input: NonNullable<Part['input']>): string | undefined {
  const { pattern, path, glob } = input
  if (typeof pattern !== 'string') return undefined
  const where = [
    typeof path === 'string' ? `in ${path}` : '',
    typeof glob === 'string' ? `glob ${glob}` : '',
  ]
  return [pattern, ...where.filter(Boolean)].join(' ')
}

function useOf(part: Part): Use | undefined {
  const input = part.input ?? {}
  const value =
    part.name === 'Skill'
      ? input.skill
      : part.name === 'Read'
        ? input.file_path
        : searchLabel(input)
  if (typeof value !== 'string') return undefined
  if (part.name === 'Skill') return { kind: 'skills', value }
  if (part.name === 'Read') return { kind: 'reads', value }
  return part.name === 'Grep' || part.name === 'Glob' ? { kind: 'searches', value } : undefined
}

type Tools = { skills: string[]; reads: string[]; searches: string[] }

/**
 * Distinct skills loaded, files read and searches made by a stream-json run, in first-use order:
 * each `Skill`, `Read`, `Grep` or `Glob` tool_use whose tool_result came back without an error. A
 * request that failed or got no result does not count; a subagent's calls count like any other.
 */
function toolUses(events: readonly Record<string, unknown>[]): Tools {
  const requested = new Map<unknown, Use>()
  const succeeded = new Set<unknown>()
  for (const event of events) {
    const content = (event.message as { content?: unknown } | undefined)?.content
    if (!Array.isArray(content)) continue
    for (const part of content as Part[]) {
      if (event.type === 'assistant' && part?.type === 'tool_use') {
        const use = useOf(part)
        if (use !== undefined) requested.set(part.id, use)
      } else if (event.type === 'user' && part?.type === 'tool_result' && part.is_error !== true) {
        succeeded.add(part.tool_use_id)
      }
    }
  }
  const done = [...requested].filter(([id]) => succeeded.has(id)).map(([, use]) => use)
  const pick = (kind: Use['kind']) => [
    ...new Set(done.filter((use) => use.kind === kind).map((use) => use.value)),
  ]
  return { skills: pick('skills'), reads: pick('reads'), searches: pick('searches') }
}

export type RunStream = {
  /** `structured_output` of the last event that has one; undefined when none does. */
  structured: unknown
  skills: string[]
  /** Distinct `file_path` of each successful `Read`, as the model gave it. */
  reads: string[]
  /** Distinct pattern (with path or glob) of each successful `Grep` or `Glob`. */
  searches: string[]
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
    ...toolUses(events),
    usage: parseUsage(final),
  }
}

/** A `stream-json` run: the stream's answer, skills, reads and searches, and what its last result event reported. */
export function readTranscript(stdout: string, what: string): HarnessResult {
  const stream = readStream(stdout, what)
  const event = resultEvent(stdout)
  return { ...stream, reportedUsage: event === undefined ? null : parseUsage(event) }
}

/** One `--output-format json` object: the answer is its `structured_output`. */
export function readResult(stdout: string): HarnessResult {
  const parsed = JSON.parse(stdout) as { structured_output?: unknown } | null
  const usage = parseUsage(resultEvent(stdout))
  return {
    structured: parsed?.structured_output,
    skills: [],
    reads: [],
    searches: [],
    usage,
    reportedUsage: usage,
  }
}
