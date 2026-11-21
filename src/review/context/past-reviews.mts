import { join } from 'node:path'

import { asNumber, asRecord, asString } from '../../tracker/json.mts'
import { foldRows, parseRows, TRACKER_FILE } from '../../tracker/store.mts'
import type { TrackerRow } from '../../tracker/types.mts'
import type { ContextDeps, ContextInput, ContextSection, SectionBuilder } from './types.mts'

/** Older reviews beyond this many are counted, not listed. */
export const MAX_LISTED = 6

const SHA_RE = /^[0-9a-f]{7,64}$/u
const SORT_LAST = '￿'

async function tryRead(deps: ContextDeps, path: string): Promise<string | undefined> {
  try {
    return await deps.readFile(path)
  } catch {
    return undefined
  }
}

async function trackerRows(deps: ContextDeps): Promise<TrackerRow[]> {
  if (deps.stateDir === undefined) throw new Error('no state directory was provided')
  let text: string
  try {
    text = await deps.readFile(join(deps.stateDir, TRACKER_FILE))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  return foldRows(parseRows(text).rows)
}

function findingLines(report: Record<string, unknown>): string[] {
  const findings = Array.isArray(report.findings) ? report.findings : []
  return findings.map((value) => {
    const finding = asRecord(value)
    const line = asNumber(finding.line)
    const path = asString(finding.path)
    const place = path === null ? 'no file' : line === null ? path : `${path}:${line}`
    return `  - [${asString(finding.severity) ?? '?'}] ${asString(finding.title) ?? 'untitled'} (${place})`
  })
}

async function describeRun(row: TrackerRow, deps: ContextDeps): Promise<string[]> {
  const stamp = row.finishedAt ?? row.startedAt
  const when = stamp === null ? 'unknown date' : stamp.slice(0, 10)
  const posted =
    row.state === 'posted' ? `posted ${row.reviewUrl ?? 'with no recorded link'}` : 'not posted'
  const head = [
    `- \`${row.head.slice(0, 12)}\`, ${when}, ${row.mode ?? 'unknown'} mode, verdict ${row.verdict ?? 'none'}, ${row.state} (${posted})`,
  ]
  if (row.runDir === null) return [...head, '  - no run directory is recorded']
  const text = await tryRead(deps, join(row.runDir, 'report.json'))
  if (text === undefined) return [...head, `  - its run directory is gone: ${row.runDir}`]
  try {
    const lines = findingLines(asRecord(JSON.parse(text)))
    return [...head, ...(lines.length === 0 ? ['  - no findings'] : lines)]
  } catch {
    return [...head, `  - its report.json is not readable: ${row.runDir}`]
  }
}

async function reRange(latest: TrackerRow, input: ContextInput, deps: ContextDeps) {
  const lines: string[] = []
  if (latest.runDir === null) {
    lines.push('Saved evidence: none, no run directory is recorded.')
  } else {
    const evidence = join(latest.runDir, 'evidence.json')
    const found = (await tryRead(deps, evidence)) !== undefined
    lines.push(`Saved evidence: ${found ? evidence : `${evidence} (missing)`}`)
  }
  if (latest.head === input.headSha) {
    lines.push('The latest review covered the current head; a re-review has no new range.')
    return lines
  }
  const range = `${latest.head}..${input.headSha}`
  lines.push(`Re-review range: \`${range}\``)
  if (!SHA_RE.test(latest.head)) return [...lines, 'Diff: the recorded head is not a commit id.']
  try {
    for (const sha of [latest.head, input.headSha]) {
      await deps.exec('git', ['-C', input.tree, 'cat-file', '-e', `${sha}^{commit}`])
    }
    const stat = await deps.exec('git', ['-C', input.tree, 'diff', '--stat', range])
    lines.push('', '```', stat.trimEnd() || 'no changes', '```')
  } catch {
    lines.push('Diff: one of the commits is not in the local checkout.')
  }
  return lines
}

/** This machine's earlier reviews of the pull request, from the tracker and their run directories. */
export const pastReviews: SectionBuilder = {
  name: 'past-reviews',
  async build(input, deps): Promise<ContextSection | null> {
    const repo = input.repo.toLowerCase()
    const mine = (await trackerRows(deps))
      .filter((row) => row.repo.toLowerCase() === repo && row.pr === input.pr)
      .sort((a, b) => (a.startedAt ?? SORT_LAST).localeCompare(b.startedAt ?? SORT_LAST))
    const listed = mine.filter((row) => row.state !== 'failed' && row.state !== 'skipped')
    if (listed.length === 0) return null
    const shown = listed.slice(-MAX_LISTED)
    const described = await Promise.all(shown.map((row) => describeRun(row, deps)))
    const older = listed.length - shown.length
    const body = [
      'Earlier reviews of this pull request on this machine, oldest first. A finding was posted when its review was; the saved data does not say which findings of a review landed inline or in the review body.',
      ...(older > 0 ? [`${older} older reviews are not listed.`] : []),
      described.flat().join('\n'),
      `### Latest review\n\n${(await reRange(shown.at(-1) as TrackerRow, input, deps)).join('\n')}`,
    ]
    return { title: 'Past reviews', body: body.join('\n\n') }
  },
}
