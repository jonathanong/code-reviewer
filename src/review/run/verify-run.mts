import { EFFORT } from '../../harness/types.mts'
import type { StepRan } from '../../harness/runner.mts'
import type { Exec } from '../benchmark/exec.mts'
import { DEFAULT_STEP_MODELS, runModelStep, tierOfPlanned, type StepModels } from '../models.mts'
import type { Model } from '../plan.mts'
import { withExtraPillars } from './extra-pillar-schema.mts'
import { SKILL_READER } from './pillar-capabilities.mts'
import { referenceDomains } from './references-prompt.mts'
import { withRaisedBy } from './restate-prompt.mts'
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
  const run = await runModelStep(
    options.models ?? DEFAULT_STEP_MODELS,
    {
      keys: [options.mode === 'light' ? 'verifier.light' : 'verifier'],
      fallback: tierOfPlanned(options.model),
    },
    {
      prompt: buildVerifierRunPrompt(input),
      label: 'Verifier run',
      maxTurns: REVIEW_MAX_TURNS,
      schema: withExtraPillars(
        withRaisedBy(
          withSplitProposal(
            withRegressionPrevent(REVIEW_VERIFIER_SCHEMA, input.regression),
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
  )
  return {
    ...parseReviewVerifier(
      run,
      input.findings.length,
      input.threads,
      input.restate,
      input.regression,
      input.split,
    ),
    ran: run.ran,
  }
}
