import {
  describeStepFailure,
  type StepRan,
  type StepRequest,
  type StepRun,
} from '../../harness/runner.mts'
import type { Exec } from '../benchmark/exec.mts'
import { addUsage, type Usage } from '../benchmark/usage.mts'
import { DEFAULT_STEP_MODELS, runModelStep, type StepModels, type Tier } from '../models.mts'
import type { Model } from '../plan.mts'
import type { Pillar } from '../pillar-name.mts'
import type { PillarOutput } from './pillar-output.mts'
import type { FailedAttempt, PillarResult } from './types.mts'

export type PillarAttempt<T extends PillarOutput> = {
  pillar: Pillar
  /** The planned model, used for the record when no run answered. */
  model: Model
  step: { keys: readonly string[]; fallback: Tier }
  request: StepRequest
  models: StepModels | undefined
  exec: Exec
  /** Reads the run's answer; throws when it fails validation, which makes the attempt fail. */
  parse(run: StepRun): T
}

/**
 * Runs one pillar-shaped step with one retry, since a model call can fail for reasons that do not
 * repeat. `parsed` is what `parse` returned; it is absent when both attempts failed.
 */
export async function attemptPillar<T extends PillarOutput>(
  input: PillarAttempt<T>,
): Promise<{ result: PillarResult; parsed?: T }> {
  const { pillar, model } = input
  const failedAttempts: FailedAttempt[] = []
  let ran: StepRan | undefined
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let reported: Usage | null = null
    try {
      const run = await runModelStep(
        input.models ?? DEFAULT_STEP_MODELS,
        input.step,
        input.request,
        input.exec,
      )
      ran = run.ran
      reported = addUsage(run.failedUsage, run.reportedUsage)
      const parsed = input.parse(run)
      const { findings, skills, usage } = parsed
      const result = { pillar, model: run.ran.model, skills, findings, usage, failedAttempts, ran }
      return { result, parsed }
    } catch (error) {
      const { message, usage, ran: failedRun } = describeStepFailure(error)
      ran = failedRun ?? ran
      // A run that answered but failed validation still cost what its result event says.
      failedAttempts.push({ error: message, usage: usage ?? reported })
    }
  }
  const error = (failedAttempts.at(-1) as FailedAttempt).error
  const result = {
    pillar,
    model: ran?.model ?? model,
    skills: [],
    findings: [],
    usage: null,
    error,
    failedAttempts,
    ...(ran === undefined ? {} : { ran }),
  }
  return { result }
}
