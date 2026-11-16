import { FinalReviewError, parseFinalReviewInput, type Finding, type Pillar } from '../finding.mts'
import { isObject, jsonEvents, jsonLines } from '../benchmark/stream-json.mts'
import { parseUsage, type Usage } from '../benchmark/usage.mts'

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
  if (jsonLines(stdout).length === 0) throw new FinalReviewError(`${what} did not print JSON.`)
  const events = jsonEvents(stdout)
  const answer = events.findLast((event) => isObject(event.structured_output))
  const final = events.findLast((event) => event.type === 'result') ?? answer
  return {
    structured: answer?.structured_output,
    skills: loadedSkills(events),
    usage: parseUsage(final),
  }
}

export type PillarOutput = { findings: Finding[]; skills: string[]; usage: Usage }

/** Reads a pillar run: its findings tagged with the pillar, the skills it loaded, and usage. */
export function parsePillarOutput(stdout: string, pillar: Pillar): PillarOutput {
  const { structured, skills, usage } = readStream(stdout, 'Pillar run')
  const found = (structured as { findings?: unknown } | undefined)?.findings
  if (!Array.isArray(found)) {
    throw new FinalReviewError('Pillar run returned no structured findings.')
  }
  const findings = found.map((finding: unknown) =>
    isObject(finding) ? { ...finding, pillar } : finding,
  )
  return { findings: parseFinalReviewInput({ findings }).findings, skills, usage }
}
