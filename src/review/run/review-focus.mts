import { FOCUS_PILLAR } from '../focus.mts'
import { runFocus, type FocusRun } from './focus-run.mts'
import { runPillars, type PillarsInput } from './pillars.mts'
import type { PillarResult } from './types.mts'

export type PillarsAndFocus = {
  /** What the planned pillars returned. */
  results: PillarResult[]
  /** The pillars and, when points were supplied, the focus step: what the verifier and the report see. */
  judged: PillarResult[]
  focus?: FocusRun
  /** The names a finding's `pillar` may take beyond the built-in ones. */
  extraPillars: string[]
}

export type FocusRange = { baseSha?: string | undefined; headSha?: string | undefined }

/**
 * Runs the planned pillars and, when the requester gave points, the focus step beside them. The
 * focus step runs whatever the plan dispatched, and its points reach no one else: the pillars read
 * the run directory, so the answers reach disk only in `review.json`, after every step.
 */
export async function runPillarsAndFocus(
  input: PillarsInput,
  points: readonly string[] | undefined,
  range?: FocusRange,
): Promise<PillarsAndFocus> {
  const extra = (input.extra ?? []).map((entry) => entry.name as string)
  const [results, focus] = await Promise.all([
    runPillars(input),
    points === undefined
      ? undefined
      : runFocus({ ...input, points, baseSha: range?.baseSha, headSha: range?.headSha }),
  ])
  if (focus === undefined) return { results, judged: results, extraPillars: extra }
  return {
    results,
    judged: [...results, focus.result],
    focus,
    extraPillars: [...extra, FOCUS_PILLAR],
  }
}
