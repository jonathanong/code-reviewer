import { isFreeModel } from '../harness/free-model.mts'
import { harnessNamed } from '../harness/registry.mts'
import { HarnessRefusal } from '../harness/refusal.mts'
import { READ_ONLY, type Candidate } from '../harness/types.mts'
import { HISTORY_COMMANDS } from './run/pillar-capabilities.mts'

/** Steps whose model must be one the owner pays for: a free model never judges findings or approves. */
const NO_FREE_STEPS: readonly string[] = ['verifier', 'verifier.light', 'approvalCheck', 'replies']

/**
 * Shell a step always asks for, known from its key alone. Web hosts are not here: the correctness
 * and security pillars and the verifier get them only when `references` configures some, so an
 * adapter's refusal of those stays a run-time refusal.
 */
const SHELL_STEPS: Readonly<Record<string, readonly string[]>> = {
  'pillar.history': HISTORY_COMMANDS,
  evidence: ['configured command'],
}

function refusal(candidate: Candidate, step: string, shell: readonly string[]): string | undefined {
  try {
    harnessNamed(candidate.harness)?.assertCan?.({
      prompt: '',
      label: step,
      model: candidate.model,
      maxTurns: 0,
      schema: {},
      can: { ...READ_ONLY, shell },
    })
  } catch (error) {
    // `assertCan` throws nothing but a refusal.
    return (error as HarnessRefusal).message
  }
  return undefined
}

/**
 * Why a step's candidate list can never run it: a free model on a step that bars them, or a shell
 * step whose every candidate's adapter refuses shell. A refusing candidate ahead of one that can
 * run is fine; the runner moves on.
 */
export function stepProblems(step: string, list: readonly Candidate[]): string[] {
  const problems = NO_FREE_STEPS.includes(step)
    ? list
        .filter(({ model }) => isFreeModel(model))
        .map(({ model }) => `step "${step}" cannot use the free model "${model}"`)
    : []
  const shell = SHELL_STEPS[step]
  if (shell !== undefined && list.length > 0) {
    const refusals = list.map((candidate) => refusal(candidate, step, shell))
    if (refusals.every((reason) => reason !== undefined)) {
      problems.push(`step "${step}" has no candidate that can run it (${refusals.join('; ')})`)
    }
  }
  return problems
}
