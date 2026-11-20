import { resolve } from 'node:path'

import { explainRun } from '../explain/explain.mts'
import { FORMATS, formatRows, type Format } from '../tracker/format.mts'
import { foldRows, readRows } from '../tracker/store.mts'
import { TRACKER_STATES, type TrackerIo, type TrackerRow } from '../tracker/types.mts'

export type TrackerValues = {
  repo?: string[] | undefined
  pr?: string | undefined
  since?: string | undefined
  state?: string | undefined
  format?: string | undefined
  run?: string | undefined
}

function choice<T extends string>(flag: string, options: readonly T[], value: string): T {
  const found = options.find((option) => option === value)
  if (found === undefined) throw new Error(`--${flag} must be one of ${options.join(', ')}.`)
  return found
}

/** When the run last changed, for `--since` and for picking the latest run of a pull request. */
const lastChange = (row: TrackerRow) => row.postedAt ?? row.finishedAt ?? row.startedAt ?? ''

/** The folded rows matching the flags, and the problems found reading the file. */
function select(values: TrackerValues, io: TrackerIo) {
  const since = values.since === undefined ? undefined : Date.parse(values.since)
  if (since !== undefined && Number.isNaN(since)) throw new Error('--since must be an ISO date.')
  const state =
    values.state === undefined ? undefined : choice('state', TRACKER_STATES, values.state)
  const repos = new Set((values.repo ?? []).map((repo) => repo.toLowerCase()))
  const { rows, problems } = readRows(io)
  const matching = foldRows(rows).filter(
    (row) =>
      (repos.size === 0 || repos.has(row.repo.toLowerCase())) &&
      (state === undefined || row.state === state) &&
      (since === undefined || Date.parse(lastChange(row)) >= since),
  )
  return { rows: matching, problems }
}

/** `code-reviewer tracker`: the current state of every tracked review run. */
export function trackerCommand(
  values: TrackerValues,
  io: TrackerIo,
): { output: string; problems: string[] } {
  const format: Format = choice('format', FORMATS, values.format ?? 'json')
  const { rows, problems } = select(values, io)
  return { output: formatRows(rows, format), problems }
}

/** `code-reviewer explain`: the explainer for `--run`, or for the latest tracked run of `--repo/--pr`. */
export function explainCommand(values: TrackerValues, io: TrackerIo): string {
  if (values.run !== undefined) return explainRun(io, resolve(values.run))
  const repo = values.repo?.[0]
  if (repo === undefined || values.pr === undefined) {
    throw new Error('explain needs --run, or --repo and --pr.')
  }
  const pr = Number(values.pr)
  const latest = select({ repo: [repo] }, io)
    .rows.filter((row) => row.pr === pr && row.runDir !== null)
    .sort((a, b) => lastChange(a).localeCompare(lastChange(b)))
    .at(-1)
  if (latest === undefined)
    throw new Error(`no tracked run with a run directory for ${repo}#${pr}.`)
  return explainRun(io, latest.runDir as string, { repo, pr, title: latest.title })
}
