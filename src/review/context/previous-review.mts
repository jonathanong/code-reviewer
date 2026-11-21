import { join } from 'node:path'

import { asNumber, asRecord, asString } from '../../tracker/json.mts'
import type { TrackerRow } from '../../tracker/types.mts'
import type { ContextDeps, ContextInput, ContextSection, PreviousFinding } from './types.mts'

const SHA_RE = /^[0-9a-f]{7,64}$/u

export async function tryRead(deps: ContextDeps, path: string): Promise<string | undefined> {
  try {
    return await deps.readFile(path)
  } catch {
    return undefined
  }
}

/** The verified findings a saved `report.json` holds, in order. */
export function reportFindings(report: Record<string, unknown>): PreviousFinding[] {
  const findings = Array.isArray(report.findings) ? report.findings : []
  return findings.map((value) => {
    const finding = asRecord(value)
    return {
      severity: asString(finding.severity),
      title: asString(finding.title),
      pillar: asString(finding.pillar),
      path: asString(finding.path),
      line: asNumber(finding.line),
    }
  })
}

async function isAncestor(sha: string, input: ContextInput, deps: ContextDeps): Promise<boolean> {
  try {
    await deps.exec('git', ['-C', input.tree, 'merge-base', '--is-ancestor', sha, input.headSha])
    return true
  } catch {
    return false
  }
}

type Found = Pick<ContextSection, 'previous' | 'previousNote'>

async function readReview(row: TrackerRow, deps: ContextDeps): Promise<Found> {
  const sha = row.head.slice(0, 12)
  if (row.runDir === null) return { previousNote: `the review of ${sha} has no run directory` }
  const text = await tryRead(deps, join(row.runDir, 'report.json'))
  if (text === undefined) {
    return { previousNote: `the run directory of the review of ${sha} is gone` }
  }
  let report: Record<string, unknown>
  try {
    report = asRecord(JSON.parse(text))
  } catch {
    return { previousNote: `the report.json of the review of ${sha} is not readable` }
  }
  const stamp = row.finishedAt ?? row.startedAt
  return {
    previous: {
      sha: row.head,
      date: stamp === null ? null : stamp.slice(0, 10),
      mode: row.mode,
      verdict: row.verdict,
      posted: row.state === 'posted',
      reviewUrl: row.reviewUrl,
      findings: reportFindings(report),
    },
  }
}

/**
 * The newest of `rows` (oldest first) whose reviewed commit is a strict ancestor of the current
 * head, read from its run directory. None when no row qualifies, such as after a force-push; the
 * note says why when the newest qualifying row could not be read, and no older row stands in.
 */
export async function previousReview(
  rows: readonly TrackerRow[],
  input: ContextInput,
  deps: ContextDeps,
): Promise<Found> {
  for (const row of rows.toReversed()) {
    const earlier = row.head !== input.headSha && row.runDir !== input.out && SHA_RE.test(row.head)
    if (earlier && (await isAncestor(row.head, input, deps))) return readReview(row, deps)
  }
  return {}
}
