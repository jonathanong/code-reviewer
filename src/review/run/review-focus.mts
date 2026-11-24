import type { Mode } from '../mode.mts'
import { FOCUS_PILLAR, MAX_FOCUS_POINTS, type FocusPoint } from '../focus.mts'
import { loadTargets, type ReviewTarget } from '../targets.mts'
import { filterTargets, type TargetSettings } from '../targets-settings.mts'
import { runFocus, type FocusRun } from './focus-run.mts'
import { runPillars, type PillarsInput } from './pillars.mts'
import type { PillarResult } from './types.mts'

export type PillarsAndFocus = {
  /** What the planned pillars returned. */
  results: PillarResult[]
  /** The pillars and, when points were supplied, the focus step: what the verifier and the report see. */
  judged: PillarResult[]
  focus?: FocusRun
  /** Selected targets omitted because requester points filled the 20-point cap. */
  droppedTargets: string[]
  /** The names a finding's `pillar` may take beyond the built-in ones. */
  extraPillars: string[]
}

export type FocusRange = {
  baseSha?: string | undefined
  headSha?: string | undefined
  /** The number of the pull request under review. */
  pr?: number | undefined
}

/** Enabled built-in targets from `<references>/targets/`, after repository config disables any. */
export function enabledReviewTargets(
  references: string,
  settings?: TargetSettings,
): ReviewTarget[] {
  return filterTargets(loadTargets(references), settings)
}

/** Resolves selected target names against the enabled targets in `<references>/targets/` (full reviews only). */
export function selectedReviewTargets(
  source: { references: string; targets?: TargetSettings },
  mode: Mode,
  selected: readonly string[] | undefined,
): ReviewTarget[] {
  if (mode !== 'full' || selected === undefined || selected.length === 0) return []
  return pickTargets(enabledReviewTargets(source.references, source.targets), selected)
}

/** Resolves the target names chosen by selection against the offered targets, in selection order. */
export function pickTargets(
  offered: readonly ReviewTarget[],
  selected: readonly string[] | undefined,
): ReviewTarget[] {
  if (selected === undefined || selected.length === 0) return []
  const byName = new Map(offered.map((target) => [target.name, target]))
  return selected.flatMap((name) => {
    const found = byName.get(name)
    return found === undefined ? [] : [found]
  })
}

/** Combines requester points first, then selected target points, up to `MAX_FOCUS_POINTS`. */
export function combineFocusPoints(
  requester: readonly string[] | undefined,
  targets: readonly ReviewTarget[] = [],
): { points: FocusPoint[]; droppedTargets: string[] } {
  const reqPoints: FocusPoint[] = (requester ?? [])
    .slice(0, MAX_FOCUS_POINTS)
    .map((point) => ({ point, origin: 'requester' }))
  const room = MAX_FOCUS_POINTS - reqPoints.length
  const kept = targets.slice(0, room)
  const droppedTargets = targets.slice(room).map((target) => target.name)
  return {
    points: [
      ...reqPoints,
      ...kept.map((target): FocusPoint => ({
        point: target.point,
        origin: `target:${target.name}`,
      })),
    ],
    droppedTargets,
  }
}

/**
 * The focus step's mode. A requester's points are checked at full effort whatever the plan: at a
 * light plan's low effort the step can return the points of a large change unexamined.
 */
export const focusMode = (
  mode: PillarsInput['mode'],
  points: ReadonlyArray<{ origin: string }>,
): PillarsInput['mode'] => (points.some((point) => point.origin === 'requester') ? 'full' : mode)

/**
 * Runs the planned pillars and, when requester or selected target points exist, the focus step
 * beside them. Points reach no one else: the pillars read the run directory, so the answers reach
 * disk only in `review.json` and the report, after every step.
 */
export async function runPillarsAndFocus(
  input: PillarsInput,
  points: readonly string[] | undefined,
  range?: FocusRange,
  targets: readonly ReviewTarget[] = [],
): Promise<PillarsAndFocus> {
  const extra = (input.extra ?? []).map((entry) => entry.name as string)
  const { points: combined, droppedTargets } = combineFocusPoints(points, targets)
  const [results, focus] = await Promise.all([
    runPillars(input),
    combined.length === 0
      ? undefined
      : runFocus({
          ...input,
          points: combined,
          mode: focusMode(input.mode, combined),
          baseSha: range?.baseSha,
          headSha: range?.headSha,
          pr: range?.pr,
        }),
  ])
  if (focus === undefined) return { results, judged: results, droppedTargets, extraPillars: extra }
  return {
    results,
    judged: [...results, focus.result],
    focus,
    droppedTargets,
    extraPillars: [...extra, FOCUS_PILLAR],
  }
}
