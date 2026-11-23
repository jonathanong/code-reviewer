import { EFFORT } from '../../harness/types.mts'
import { describeStepFailure, type StepRan } from '../../harness/runner.mts'
import type { Exec } from '../benchmark/exec.mts'
import { DEFAULT_STEP_MODELS, runModelStep, tierOfPlanned, type StepModels } from '../models.mts'
import type { Model } from '../plan.mts'
import { saveFailedSteps } from './failed-steps.mts'
import { withExtraPillars } from './extra-pillar-schema.mts'
import { SKILL_READER } from './pillar-capabilities.mts'
import { referenceDomains } from './references-prompt.mts'
import { withRaisedBy } from './restate-prompt.mts'
import { checkedImpact, withImpact } from './impact-prompt.mts'
import { withSplitProposal } from './split-prompt.mts'
import { withRegressionPrevent } from './regression-prompt.mts'
import { REVIEW_MAX_TURNS, RUN_TIMEOUT_MS } from './types.mts'
import {
  REVIEW_VERIFIER_SCHEMA,
  buildVerifierRunPrompt,
  parseReviewVerifier,
  type ReviewVerifierOutput,
  type VerifierInput,
} from './verify.mts'

/**
 * Runs the verifier once in the checkout with read-only tools and the Skill tool. `model` is the
 * planned model: it names the tier the verifier runs on unless the models config sets the step.
 */
export async function runReviewVerifier(
  input: VerifierInput,
  options: {
    model: Model
    /** Names of the configured pillars, so their findings pass the output schema. */
    extraPillars?: readonly string[]
    mode: 'light' | 'full'
    tree: string
    settings?: object
    models?: StepModels
    exec: Exec
  },
): Promise<ReviewVerifierOutput & { ran: StepRan }> {
  const impact = options.mode === 'full'
  const run = await runModelStep(
    options.models ?? DEFAULT_STEP_MODELS,
    {
      keys: [options.mode === 'light' ? 'verifier.light' : 'verifier'],
      fallback: tierOfPlanned(options.model),
    },
    {
      prompt: buildVerifierRunPrompt({ ...input, impact }),
      label: 'Verifier run',
      maxTurns: REVIEW_MAX_TURNS,
      schema: withExtraPillars(
        withRaisedBy(
          withSplitProposal(
            withRegressionPrevent(withImpact(REVIEW_VERIFIER_SCHEMA, impact), input.regression),
            input.split,
          ),
          input.restate,
        ),
        options.extraPillars ?? [],
      ),
      can: { ...SKILL_READER, web: referenceDomains(input.web) },
      cwd: options.tree,
      timeoutMs: RUN_TIMEOUT_MS,
      effort: EFFORT[options.mode],
      addDirs: [input.run.out, input.references],
      transcript: true,
      analysis: input.analysis,
      ...(options.settings === undefined ? {} : { settings: options.settings }),
    },
    options.exec,
  ).catch((error: unknown) => {
    // The review fails with the verifier, and no report is written to carry this step's `ran`.
    saveFailedSteps(input.run.out, [{ step: 'verifier', ran: describeStepFailure(error).ran }])
    throw error
  })
  return {
    ...parseReviewVerifier(
      run,
      input.findings.length,
      input.threads,
      input.restate,
      input.regression,
      input.split,
    ),
    ...checkedImpact((run.structured as { impact?: unknown }).impact, impact),
    ran: run.ran,
  }
}
