import { harness } from '../harness/opencode.mts'
import { READ_ONLY } from '../harness/types.mts'
import type { Exec } from '../review/benchmark/exec.mts'
import type { ModelsIo } from './io.mts'
import { PROBE_SCHEMA } from './probes.mts'
import type { Probe, RunRecord } from './types.mts'

const TIMEOUT_MS = 180_000
const MAX_TURNS = 8
const FAILURE_CHARS = 200

type Finding = { path: string; line: number; title: string }

const isFinding = (item: unknown): item is Finding => {
  const entry = item as Record<string, unknown> | null
  return (
    typeof entry?.path === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.line === 'number' &&
    Number.isFinite(entry.line)
  )
}

/** The findings of a reply that matches the probe schema; undefined for any other shape. */
export function readFindings(structured: unknown): Finding[] | undefined {
  const list = (structured as { findings?: unknown } | null)?.findings
  return Array.isArray(list) && list.every(isFinding) ? list : undefined
}

/** A finding on the planted file, however the model spells the path, within two lines. */
function hits(finding: Finding, planted: Probe['planted']): boolean {
  const path = finding.path.replace(/^\.\//u, '')
  const onFile = path === planted.path || path.endsWith(`/${planted.path}`)
  return onFile && Math.abs(finding.line - planted.line) <= 2
}

const oneLine = (message: string) => message.split('\n')[0]!.slice(0, FAILURE_CHARS)

/** Runs one probe on one model through the OpenCode adapter; a failure is a record, not a throw. */
export async function runProbe(
  model: string,
  probe: Probe,
  io: ModelsIo,
  exec: Exec,
): Promise<RunRecord> {
  const started = io.now()
  const seconds = () => (io.now() - started) / 1000
  const staged = await io.stage(probe.files)
  try {
    const result = await harness.run(
      {
        prompt: probe.prompt,
        label: `Probe ${probe.name}`,
        model,
        maxTurns: MAX_TURNS,
        schema: PROBE_SCHEMA,
        can: READ_ONLY,
        cwd: staged.dir,
        timeoutMs: TIMEOUT_MS,
      },
      exec,
    )
    const { usage } = result
    // The adapter always reports counts; a null count adds nothing.
    const tokens = Number(usage.inputTokens) + Number(usage.outputTokens)
    const base = { seconds: seconds(), tokens, costUsd: usage.costUsd, rateLimited: false }
    const findings = readFindings(result.structured)
    if (findings === undefined) {
      return {
        ...base,
        valid: false,
        found: false,
        extra: 0,
        failure: 'the reply did not match the findings schema',
      }
    }
    return {
      ...base,
      valid: true,
      found: findings.some((finding) => hits(finding, probe.planted)),
      extra: findings.filter((finding) => !hits(finding, probe.planted)).length,
    }
  } catch (error) {
    const { message, usage } = harness.describeFailure(error)
    return {
      valid: false,
      found: false,
      extra: 0,
      seconds: seconds(),
      tokens: null,
      costUsd: usage?.costUsd ?? null,
      rateLimited: harness.classifyFailure(error).kind === 'rate_limited',
      failure: oneLine(message),
    }
  } finally {
    await staged.remove()
  }
}
