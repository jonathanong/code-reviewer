import { join } from 'node:path'

import type { EvalCase } from './cases.mts'
import { defaultBenchDeps, type BenchDeps } from './cli.mts'
import { NO_RULES, stageCaseRules } from './rules.mts'

/** The verifier bench also stages rule sources, as the pillar bench does. */
export type VerifierBenchDeps = BenchDeps & { stageRules: typeof stageCaseRules }

export const defaultVerifierDeps: VerifierBenchDeps = {
  ...defaultBenchDeps,
  stageRules: stageCaseRules,
}

export type SnapshotOptions = {
  findingsFrom: string
  out: string
  clones: string | undefined
  noRules: boolean
  noShared: boolean
}

/**
 * Prepares a case's snapshot from the pillar run's cache and stages its rule sources into it,
 * returning the directory and the rules digest (`none` when `--no-rules`).
 */
export async function prepareVerifierSnapshot(
  item: EvalCase,
  options: SnapshotOptions,
  deps: VerifierBenchDeps,
): Promise<{ dir: string; rules: string }> {
  const cache = join(options.findingsFrom, 'cache')
  const snapshot = await deps.prepare(item, cache, join(options.out, 'work'), deps.exec)
  const rules = options.noRules
    ? NO_RULES
    : await deps.stageRules(item, snapshot, options.clones, undefined, !options.noShared)
  return { dir: snapshot.dir, rules }
}
