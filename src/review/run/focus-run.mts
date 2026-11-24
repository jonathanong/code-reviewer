import type { StepAnalysis, StepRequest } from '../../harness/runner.mts'
import { EFFORT } from '../../harness/types.mts'
import type { Exec } from '../benchmark/exec.mts'
import { FOCUS_PILLAR, type FocusAnswer, type FocusPoint } from '../focus.mts'
import type { StepModels } from '../models.mts'
import { attemptPillar } from './pillar-attempts.mts'
import { pillarCapabilities } from './pillar-capabilities.mts'
import { parsePillarOutput, type PillarOutput } from './pillar-output.mts'
import type { RunDir } from './pillar-prompt.mts'
import { buildFocusFacts } from './focus-facts.mts'
import { renderFocusFacts } from './focus-facts-render.mts'
import { buildFocusPrompt, checkedFocus, FOCUS_OUTPUT_SCHEMA, unchecked } from './focus-prompt.mts'
import { REVIEW_MAX_TURNS, RUN_TIMEOUT_MS, type PillarResult } from './types.mts'

export type FocusInput = {
  /** Requester points and selected target points; one agent checks them all. */
  points: readonly FocusPoint[]
  tree: string
  run: RunDir
  baseSha?: string | undefined
  headSha?: string | undefined
  mode: 'light' | 'full'
  contract: string
  settings?: object
  models?: StepModels | undefined
  analysis?: StepAnalysis | undefined
  contextFile?: string | undefined
  exec: Exec
}

/** The step's result as a pillar named `focus`, and one answer for each point. */
export type FocusRun = { result: PillarResult; answers: FocusAnswer[] }

/**
 * Checks the requester's points in one run, with the same context and tools as a pillar and one
 * retry. A step that fails twice is a failed pillar named `focus`, so it is listed as skipped, and
 * every point is `not_checked`. The points go only into this prompt: they are never written under
 * the run directory the pillars read.
 */
export async function runFocus(input: FocusInput): Promise<FocusRun> {
  const { points } = input
  const facts = renderFocusFacts(
    await buildFocusFacts({
      tree: input.tree,
      out: input.run.out,
      baseSha: input.baseSha,
      headSha: input.headSha,
      exec: input.exec,
    }),
  )
  const request: StepRequest = {
    prompt: buildFocusPrompt(
      { contract: input.contract, run: input.run, contextFile: input.contextFile, skills: [] },
      points,
      facts,
    ),
    label: 'Focus run',
    maxTurns: REVIEW_MAX_TURNS,
    schema: FOCUS_OUTPUT_SCHEMA,
    can: pillarCapabilities(FOCUS_PILLAR, true),
    cwd: input.tree,
    timeoutMs: RUN_TIMEOUT_MS,
    effort: EFFORT[input.mode],
    addDirs: [input.run.out],
    transcript: true,
    analysis: input.analysis,
    ...(input.settings === undefined ? {} : { settings: input.settings }),
  }
  const { result, parsed } = await attemptPillar({
    pillar: FOCUS_PILLAR,
    model: 'sonnet',
    step: { keys: ['focus', 'pillars'], fallback: 'medium' },
    request,
    models: input.models,
    exec: input.exec,
    parse: (run): PillarOutput & { answers: FocusAnswer[] } => ({
      ...parsePillarOutput(run, FOCUS_PILLAR),
      answers: checkedFocus((run.structured as { points?: unknown }).points, points),
    }),
  })
  if (parsed === undefined) {
    return { result, answers: unchecked(points, 'The step failed twice.') }
  }
  return { result, answers: parsed.answers }
}
