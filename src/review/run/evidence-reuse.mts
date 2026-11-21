import { join } from 'node:path'

import { isObject } from '../../harness/json.mts'
import type { Exec } from '../benchmark/exec.mts'
import { EVIDENCE_LIMITS } from './evidence-schema.mts'
import { evidenceHolds, pathsChangedBetween, type EvidenceScope } from './evidence-scope.mts'

const SHA_RE = /^[0-9a-f]{7,64}$/u

/** One source of the earlier review's saved evidence that is still valid at the head. */
export type HeldEvidence = {
  source: string
  /** The commit the evidence ran against. */
  commit: string
  status: string
  result: string
}

function scopeOf(raw: unknown): EvidenceScope | undefined {
  if (!isObject(raw) || raw.kind !== 'paths' || !Array.isArray(raw.paths)) return undefined
  const paths = raw.paths.filter((path): path is string => typeof path === 'string')
  return { kind: 'paths', paths }
}

function resultText(queries: unknown): string {
  const flat = (Array.isArray(queries) ? queries : [])
    .filter(isObject)
    .map((query) => `${String(query.command)} -> ${String(query.result)}`)
    .join('\n')
  return flat.length > EVIDENCE_LIMITS.result
    ? `${flat.slice(0, EVIDENCE_LIMITS.result - 1)}…`
    : flat
}

/**
 * The `checked` sources of the earlier run's `evidence.json` whose declared paths did not change
 * between the head they ran against and `headSha`. Unreadable files, a missing sha, an old file
 * without scope fields and a git failure give nothing: unknown never counts as holding.
 */
export async function heldEvidence(input: {
  runDir: string
  headSha: string
  tree: string
  exec: Exec
  readFile(path: string): Promise<string>
}): Promise<HeldEvidence[]> {
  let sources: unknown[]
  try {
    const saved: unknown = JSON.parse(await input.readFile(join(input.runDir, 'evidence.json')))
    sources = isObject(saved) && Array.isArray(saved.sources) ? saved.sources : []
  } catch {
    return []
  }
  const held: HeldEvidence[] = []
  const changes = new Map<string, string[] | undefined>()
  for (const item of sources.filter(isObject)) {
    const { name, status, headSha } = item
    if (typeof name !== 'string' || status !== 'checked') continue
    if (typeof headSha !== 'string' || !SHA_RE.test(headSha)) continue
    const scope = scopeOf(item.scope)
    if (scope === undefined) continue
    if (!changes.has(headSha)) {
      changes.set(
        headSha,
        await pathsChangedBetween(input.exec, input.tree, headSha, input.headSha),
      )
    }
    const changed = changes.get(headSha)
    if (changed === undefined || evidenceHolds({ headSha, scope }, changed) !== 'holds') continue
    held.push({ source: name, commit: headSha, status, result: resultText(item.queries) })
  }
  return held
}
