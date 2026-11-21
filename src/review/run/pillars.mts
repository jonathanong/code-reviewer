import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { describeStepFailure, type StepRan, type StepRequest } from '../../harness/runner.mts'
import { EFFORT } from '../../harness/types.mts'
import type { Exec } from '../benchmark/exec.mts'
import type { Usage } from '../benchmark/usage.mts'
import type { Pillar } from '../finding.mts'
import { DEFAULT_STEP_MODELS, runModelStep, tierOfPlanned, type StepModels } from '../models.mts'
import type { Model } from '../plan.mts'
import { WEB_PILLARS, pillarCapabilities } from './pillar-capabilities.mts'
import { buildPillarRunPrompt, type RunDir } from './pillar-prompt.mts'
import { referenceDomains, referencesBlock, type WebReferences } from './references-prompt.mts'
import { pool } from './pool.mts'
import { parsePillarOutput } from './pillar-output.mts'
import { PILLAR_OUTPUT_SCHEMA } from './pillar-schema.mts'
import {
  REVIEW_MAX_TURNS,
  RUN_TIMEOUT_MS,
  type FailedAttempt,
  type PillarResult,
} from './types.mts'

export type PillarsInput = {
  pillars: readonly { pillar: Pillar; model: Model }[]
  tree: string
  run: RunDir
  mode: 'light' | 'full'
  jobs: number
  contract: string
  /** The text of a pillar's prompt file. */
  readPillar(pillar: Pillar): string
  skills: readonly string[]
  settings?: object
  /** The harness and model of each pillar; the default tiers when absent. */
  models?: StepModels
  /** Web references; only the correctness and security pillars get them. */
  web?: WebReferences
  exec: Exec
}

async function runOne(
  input: PillarsInput,
  { pillar, model }: { pillar: Pillar; model: Model },
): Promise<PillarResult> {
  const web = WEB_PILLARS.includes(pillar) ? input.web : undefined
  const prompt = buildPillarRunPrompt({
    contract: input.contract,
    pillarText: [input.readPillar(pillar), ...referencesBlock(web)].join('\n\n'),
    run: input.run,
    skills: input.skills,
  })
  const request: StepRequest = {
    prompt,
    label: 'Pillar run',
    maxTurns: REVIEW_MAX_TURNS,
    schema: PILLAR_OUTPUT_SCHEMA,
    can: pillarCapabilities(pillar, true, referenceDomains(web)),
    cwd: input.tree,
    timeoutMs: RUN_TIMEOUT_MS,
    effort: EFFORT[input.mode],
    addDirs: [input.run.out],
    transcript: true,
    ...(input.settings === undefined ? {} : { settings: input.settings }),
  }
  const failedAttempts: FailedAttempt[] = []
  const step = { keys: [`pillar.${pillar}`, 'pillars'], fallback: tierOfPlanned(model) }
  let ran: StepRan | undefined
  // One retry: a model call can fail for reasons that do not repeat.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let reported: Usage | null = null
    try {
      const run = await runModelStep(input.models ?? DEFAULT_STEP_MODELS, step, request, input.exec)
      ran = run.ran
      reported = run.reportedUsage
      const { findings, skills, usage } = parsePillarOutput(run, pillar)
      return { pillar, model: run.ran.model, skills, findings, usage, failedAttempts, ran }
    } catch (error) {
      const { message, usage, ran: failedRun } = describeStepFailure(error)
      ran = failedRun ?? ran
      // A run that answered but failed validation still cost what its result event says.
      failedAttempts.push({ error: message, usage: usage ?? reported })
    }
  }
  const error = (failedAttempts.at(-1) as FailedAttempt).error
  return {
    pillar,
    model: ran?.model ?? model,
    skills: [],
    findings: [],
    usage: null,
    error,
    failedAttempts,
    ...(ran === undefined ? {} : { ran }),
  }
}

/** Runs the planned pillars, at most `jobs` at once, and saves each to `pillars/<pillar>.json`. */
export async function runPillars(input: PillarsInput): Promise<PillarResult[]> {
  const dir = join(input.run.out, 'pillars')
  mkdirSync(dir, { recursive: true })
  const results: PillarResult[] = []
  await pool(input.pillars, input.jobs, async (entry) => {
    const result = await runOne(input, entry)
    writeFileSync(join(dir, `${entry.pillar}.json`), `${JSON.stringify(result, null, 2)}\n`)
    results.push(result)
  })
  const order = input.pillars.map((entry) => entry.pillar)
  return results.sort((a, b) => order.indexOf(a.pillar) - order.indexOf(b.pillar))
}
