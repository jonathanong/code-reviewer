import { resolve } from 'node:path'

import type { TrackerIo } from '../tracker/types.mts'
import { collectOutcomes, DEFAULT_SINCE_DAYS, MAX_PULLS } from './collect.mts'
import { writeDigest } from './digest.mts'
import { saveMisses, saveOutcomes } from './store.mts'
import { OUTCOMES, type OutcomesIo } from './types.mts'

export type OutcomesValues = {
  repo?: string[] | undefined
  owner?: string | undefined
  pr?: string | undefined
  since?: string | undefined
  day?: string | undefined
  out?: string | undefined
}

const positive = (flag: string, value: string | undefined, fallback: number | undefined) => {
  if (value === undefined) return fallback
  const number = Number(value)
  if (!Number.isInteger(number) || number < 1)
    throw new Error(`--${flag} must be a positive integer.`)
  return number
}

/**
 * `code-reviewer outcomes`: reads GitHub, never writes to it, and stores one row per finding.
 * Returns the JSON summary and the lines for stderr.
 */
export async function outcomesCommand(
  values: OutcomesValues,
  tracker: TrackerIo,
  io: OutcomesIo,
): Promise<{ summary: object; messages: string[] }> {
  const repos = values.repo ?? []
  if (repos.length === 0 && values.owner === undefined) {
    throw new Error('outcomes needs --repo or --owner.')
  }
  const { rows, misses, pulls, notChecked, problems } = await collectOutcomes(
    {
      repos,
      owner: values.owner,
      pr: positive('pr', values.pr, undefined),
      sinceDays: positive('since', values.since, DEFAULT_SINCE_DAYS) as number,
    },
    tracker,
    io,
  )
  const stored = saveOutcomes(tracker, rows)
  saveMisses(tracker, misses)
  const byOutcome = Object.fromEntries(
    OUTCOMES.map((outcome) => [outcome, rows.filter((row) => row.outcome === outcome).length]),
  )
  const messages = [...problems]
  if (notChecked > 0) {
    messages.push(`${notChecked} more pull requests not checked (at most ${MAX_PULLS} per run).`)
  }
  return {
    summary: {
      pulls,
      findings: rows.length,
      stored: stored.length,
      candidateMisses: misses.length,
      notChecked,
      byOutcome,
    },
    messages,
  }
}

/** `code-reviewer outcomes digest`: writes the Markdown digest and returns its path. */
export function digestCommand(values: OutcomesValues, tracker: TrackerIo): { path: string } {
  const day = values.day ?? tracker.now().toISOString().slice(0, 10)
  const out = values.out === undefined ? undefined : resolve(values.out)
  return { path: writeDigest(tracker, day, out) }
}
