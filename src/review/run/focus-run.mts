import type { StepAnalysis, StepRequest } from '../../harness/runner.mts'
import { EFFORT } from '../../harness/types.mts'
import type { Exec } from '../benchmark/exec.mts'
import { addUsage, type Usage } from '../benchmark/usage.mts'
import { FOCUS_PILLAR, type FocusAnswer, type FocusPoint } from '../focus.mts'
import type { StepModels } from '../models.mts'
import { attemptPillar } from './pillar-attempts.mts'
import { pillarCapabilities } from './pillar-capabilities.mts'
import { parsePillarOutput, type PillarOutput } from './pillar-output.mts'
import type { RunDir } from './pillar-prompt.mts'
import { buildFocusFacts } from './focus-facts.mts'
import { renderFocusFacts } from './focus-facts-render.mts'
import { buildNamedPrFacts, namedPullRequests } from './focus-named-prs.mts'
import { renderNamedPrFacts } from './focus-named-render.mts'
import { buildFocusPrompt, checkedFocus, FOCUS_OUTPUT_SCHEMA, unchecked } from './focus-prompt.mts'
import { REVIEW_MAX_TURNS, RUN_TIMEOUT_MS, type PillarResult } from './types.mts'

export type FocusInput = {
  /** Requester points share one call; each selected target point gets a call of its own. */
  points: readonly FocusPoint[]
  tree: string
  run: RunDir
  baseSha?: string | undefined
  headSha?: string | undefined
  /** The number of the pull request under review; a point naming it names no other one. */
  pr?: number | undefined
  /** Pull request number to a pinned commit, used in place of the live `refs/pull/<n>/head`. */
  refs?: Readonly<Record<string, string>> | undefined
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
 * Checks one group of points in one run, with the same context and tools as a pillar and one
 * retry. A call that fails twice is a failed pillar named `focus` and each of its points is
 * `not_checked`. The points go only into this prompt: they are never written under the run
 * directory the pillars read.
 */
async function runFocusCall(input: FocusInput, points: readonly FocusPoint[]): Promise<FocusRun> {
  const changeFacts = renderFocusFacts(
    await buildFocusFacts({
      tree: input.tree,
      out: input.run.out,
      baseSha: input.baseSha,
      headSha: input.headSha,
      exec: input.exec,
    }),
  )
  const named = renderNamedPrFacts(
    await buildNamedPrFacts(namedPullRequests(points, input.pr), input),
  )
  const blocks = [...(changeFacts === undefined ? [] : [changeFacts]), ...named]
  const facts = blocks.length === 0 ? undefined : blocks.join('\n\n')
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

/**
 * Checks every point. Requester points share one call. Each target point gets its own call,
 * because a target asked beside several other points comes back unexamined. The calls run
 * together; the step is listed as skipped only when every call failed.
 */
export async function runFocus(input: FocusInput): Promise<FocusRun> {
  const { points } = input
  const requester = points.flatMap((point, at) => (point.origin === 'requester' ? [at] : []))
  const targets = points.flatMap((point, at) => (point.origin === 'requester' ? [] : [[at]]))
  const groups = requester.length === 0 ? targets : [requester, ...targets]
  if (groups.length <= 1) return runFocusCall(input, points)
  const runs = await Promise.all(
    groups.map((group) =>
      runFocusCall(
        input,
        group.map((at) => points[at] as FocusPoint),
      ),
    ),
  )
  const answers: FocusAnswer[] = []
  groups.forEach((group, run) =>
    group.forEach((at, nth) => {
      answers[at] = (runs[run] as FocusRun).answers[nth] as FocusAnswer
    }),
  )
  const results = runs.map((run) => run.result)
  const first = results.find((result) => result.error === undefined) ?? (results[0] as PillarResult)
  const failed = results.every((result) => result.error !== undefined)
  const result: PillarResult = {
    pillar: FOCUS_PILLAR,
    model: first.model,
    skills: [...new Set(results.flatMap((entry) => entry.skills))],
    findings: results.flatMap((entry) => entry.findings),
    usage: results.reduce<Usage | null>((sum, entry) => addUsage(sum, entry.usage), null),
    failedAttempts: results.flatMap((entry) => entry.failedAttempts),
    ...(failed ? { error: first.error as string } : {}),
    ...(first.ran === undefined ? {} : { ran: first.ran }),
  }
  return { result, answers }
}
