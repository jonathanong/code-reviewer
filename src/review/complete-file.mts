import { rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const COMPLETE_FILE = 'complete.json'

/**
 * Written once `review.json` is, which is after every pillar, the verifier, the approval check
 * and the evidence step finished. A run that stopped anywhere earlier has none, so it is never
 * mistaken for a whole review; the head it names keeps a reused run directory honest.
 */
export function markComplete(out: string, headSha: string): void {
  writeFileSync(join(out, COMPLETE_FILE), `${JSON.stringify({ headSha })}\n`)
}

/** Removes the mark of an earlier run in the same directory; called before a run begins. */
export function clearComplete(out: string): void {
  rmSync(join(out, COMPLETE_FILE), { force: true })
}

/** The head the run directory holds a whole review of; undefined when it holds none. */
export function completedHead(
  read: (path: string) => string | undefined,
  out: string,
): string | undefined {
  try {
    const parsed: unknown = JSON.parse(read(join(out, COMPLETE_FILE)) ?? 'null')
    const head = (parsed as { headSha?: unknown } | null)?.headSha
    return typeof head === 'string' ? head : undefined
  } catch {
    return undefined
  }
}
