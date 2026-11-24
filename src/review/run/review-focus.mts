import { join } from 'node:path'

import { FOCUS_PILLAR } from '../focus.mts'
import { runFocus, type FocusRun } from './focus-run.mts'
import { runPillars, type PillarsInput } from './pillars.mts'
import type { PillarResult } from './types.mts'
import { writeJson } from './review-support.mts'

export type PillarsAndFocus = {
  /** What the planned pillars returned. */
  results: PillarResult[]
  /** The pillars and, when points were supplied, the focus step: what the verifier and the report see. */
  judged: PillarResult[]
  focus?: FocusRun
  /** The names a finding's `pillar` may take beyond the built-in ones. */
  extraPillars: string[]
}

/**
 * Runs the planned pillars and, when the requester gave points, the focus step beside them. The
 * focus step runs whatever the plan dispatched, and its points reach no one else: the pillars read
 * the run directory, so nothing about them is written there until `saveFocus`, after every step.
 */
export async function runPillarsAndFocus(
  input: PillarsInput,
  points: readonly string[] | undefined,
): Promise<PillarsAndFocus> {
  const extra = (input.extra ?? []).map((entry) => entry.name as string)
  const [results, focus] = await Promise.all([
    runPillars(input),
    points === undefined ? undefined : runFocus({ ...input, points }),
  ])
  if (focus === undefined) return { results, judged: results, extraPillars: extra }
  return {
    results,
    judged: [...results, focus.result],
    focus,
    extraPillars: [...extra, FOCUS_PILLAR],
  }
}

/** Saves what the focus step answered, for the points as the requester gave them. */
export function saveFocus(out: string, focus: FocusRun | undefined): void {
  if (focus !== undefined) writeJson(join(out, 'focus.json'), focus.answers)
}
