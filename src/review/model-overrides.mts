import { HARNESS_NAMES } from '../harness/registry.mts'
import { STEP_NAMES, isStepName, type Candidate } from './models.mts'
import { stepProblems } from './step-check.mts'

/**
 * `--model step=harness:model` flags. A step named twice gets its candidates in flag order, as
 * fallbacks. A model ending in `+outside` marks that candidate `readsOutsideCheckout`, as the
 * config key does. Throws a message fit for a usage error.
 */
export function parseModelOverrides(values: readonly string[]): Record<string, Candidate[]> {
  const found: Record<string, Candidate[]> = {}
  for (const value of values) {
    const match = /^([^=]+)=([^:=]+):(.+?)(\+outside)?$/u.exec(value)
    if (match === null) throw new Error(`--model ${value}: expected step=harness:model.`)
    const [, step, harness, model, outside] = match as unknown as [
      string,
      string,
      string,
      string,
      string?,
    ]
    if (!isStepName(step)) {
      throw new Error(
        `--model ${value}: unknown step "${step}"; use ${STEP_NAMES.join(', ')}, or pillar.<name> for a configured pillar.`,
      )
    }
    if (!HARNESS_NAMES.includes(harness)) {
      throw new Error(
        `--model ${value}: unknown harness "${harness}"; use ${HARNESS_NAMES.join(', ')}.`,
      )
    }
    found[step] = [
      ...(found[step] ?? []),
      outside === undefined ? { harness, model } : { harness, model, readsOutsideCheckout: true },
    ]
  }
  for (const [step, list] of Object.entries(found)) {
    const [problem] = stepProblems(step, list)
    if (problem !== undefined) throw new Error(`--model ${step}: ${problem}.`)
  }
  return found
}
