import type { Exec } from './benchmark/exec.mts'
import { HARNESS_NAMES } from '../harness/registry.mts'
import { watchStep, type StepWatch } from './step-watch.mts'
import {
  DEFAULT_MAX_WAIT_SECONDS,
  describeStepFailure,
  realRuntime,
  runStep,
  type StepRun,
  type StepRequest,
  type StepRuntime,
} from '../harness/runner.mts'
import type { Candidate } from '../harness/types.mts'
import { PILLARS } from './pillar-name.mts'
import { stepProblems } from './step-check.mts'
import type { Model } from './plan.mts'

export type { Candidate } from '../harness/types.mts'

export const TIERS = ['small', 'medium', 'large'] as const
export type Tier = (typeof TIERS)[number]

/** A step's setting: a tier name, or its own ordered fallback list. */
export type StepModel = Tier | Candidate[]

/** The `models` key as a config file sets it; every part is optional. */
export type ModelConfig = {
  tiers?: Partial<Record<Tier, Candidate[]>>
  steps?: Record<string, StepModel>
  retry?: { maxWaitSeconds: number }
}

/** What every step resolves against: the tiers, the steps that were set, and the wait budget. */
export type ModelPlan = {
  tiers: Record<Tier, Candidate[]>
  /** Only the steps something set; a step not here takes the default its call site passes. */
  steps: Record<string, StepModel>
  retry: { maxWaitSeconds: number }
}

export const DEFAULT_TIERS: Record<Tier, Candidate[]> = {
  small: [{ harness: 'claude', model: 'haiku' }],
  medium: [{ harness: 'claude', model: 'sonnet' }],
  large: [{ harness: 'claude', model: 'opus' }],
}

/** The tier each step runs on when nothing sets it. A docs-only review also runs its pillars on `small`. */
export const DEFAULT_STEPS: Record<string, Tier> = {
  select: 'small',
  pillars: 'medium',
  'pillar.history': 'small',
  verifier: 'large',
  'verifier.light': 'medium',
  evidence: 'medium',
  approvalCheck: 'large',
}

export const DEFAULT_MODEL_PLAN: ModelPlan = {
  tiers: DEFAULT_TIERS,
  steps: {},
  retry: { maxWaitSeconds: DEFAULT_MAX_WAIT_SECONDS },
}

/** Steps a config or `--model` may name: the fixed ones, and `pillar.<name>` for each pillar. */
export const STEP_NAMES: readonly string[] = [
  ...Object.keys(DEFAULT_STEPS),
  ...PILLARS.map((pillar) => `pillar.${pillar}`),
]

/** A step for a configured pillar: `pillar.` and its name. */
export const EXTRA_PILLAR_STEP = /^pillar\.[a-z][a-z0-9-]*$/u

/** Whether a config or `--model` may name `step`: a fixed step, or one for a configured pillar. */
export const isStepName = (step: string): boolean =>
  STEP_NAMES.includes(step) || EXTRA_PILLAR_STEP.test(step)

const DEFAULT_TIER_OF: Record<Model, Tier> = { haiku: 'small', sonnet: 'medium', opus: 'large' }

/** The tier a planned model name stands for; `plan.json` still records the model names. */
export const tierOfPlanned = (model: Model): Tier => DEFAULT_TIER_OF[model]

/**
 * The candidates for a step. `keys` run most specific first (`pillar.design`, then `pillars`); a
 * step nothing set runs on `fallback`'s tier.
 */
export function candidatesFor(
  plan: ModelPlan,
  keys: readonly string[],
  fallback: Tier,
): Candidate[] {
  const key = keys.find((name) => plan.steps[name] !== undefined)
  const setting = key === undefined ? fallback : (plan.steps[key] as StepModel)
  return typeof setting === 'string' ? plan.tiers[setting] : setting
}

/** The plan a config's `models` key gives, then the `--model` overrides, which win. */
export function resolveModelPlan(
  config: ModelConfig | undefined,
  overrides: Record<string, Candidate[]> = {},
): ModelPlan {
  return {
    tiers: { ...DEFAULT_TIERS, ...config?.tiers },
    steps: { ...config?.steps, ...overrides },
    retry: config?.retry ?? DEFAULT_MODEL_PLAN.retry,
  }
}

/**
 * `--model step=harness:model` flags. A step named twice gets its candidates in flag order, as
 * fallbacks. Throws a message fit for a usage error.
 */
export function parseModelOverrides(values: readonly string[]): Record<string, Candidate[]> {
  const found: Record<string, Candidate[]> = {}
  for (const value of values) {
    const match = /^([^=]+)=([^:=]+):(.+)$/u.exec(value)
    if (match === null) throw new Error(`--model ${value}: expected step=harness:model.`)
    const [, step, harness, model] = match as unknown as [string, string, string, string]
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
    found[step] = [...(found[step] ?? []), { harness, model }]
  }
  for (const [step, list] of Object.entries(found)) {
    const [problem] = stepProblems(step, list)
    if (problem !== undefined) throw new Error(`--model ${step}: ${problem}.`)
  }
  return found
}

/** The keys a step looks up, most specific first: a pillar falls back to `pillars`. */
export const stepKeys = (step: string): string[] =>
  step.startsWith('pillar.') ? [step, 'pillars'] : [step]

/** Each step with the candidates the runner resolves it to, for `settings`. */
export function modelTable(plan: ModelPlan): Record<string, Candidate[]> {
  const steps = { ...DEFAULT_STEPS, ...plan.steps }
  return Object.fromEntries(
    Object.keys(steps).map((step) => [
      step,
      candidatesFor(plan, stepKeys(step), DEFAULT_STEPS[step] as Tier),
    ]),
  )
}

/** The plan, and the sleep and clock its waits use; tests replace the clock. */
export type StepModels = {
  plan: ModelPlan
  clock?: Pick<StepRuntime, 'sleep' | 'now'>
  /** Progress lines and the cost ceiling of one review; steps run without them when absent. */
  watch?: StepWatch
}

export const DEFAULT_STEP_MODELS: StepModels = { plan: DEFAULT_MODEL_PLAN }

/** Runs one step on the candidates `keys` resolve to, falling back to `fallback`'s tier. */
export function runModelStep(
  models: StepModels,
  step: { keys: readonly string[]; fallback: Tier },
  request: StepRequest,
  exec: Exec,
): Promise<StepRun> {
  const runtime = { ...realRuntime(models.plan.retry.maxWaitSeconds), ...models.clock }
  const candidates = candidatesFor(models.plan, step.keys, step.fallback)
  const { watch } = models
  if (watch === undefined || candidates.length === 0)
    return runStep(request, candidates, exec, runtime)
  return watchStep(
    watch,
    step.keys[0] as string,
    candidates[0] as Candidate,
    (onWait) => runStep(request, candidates, exec, { ...runtime, onWait }),
    describeStepFailure,
  )
}
