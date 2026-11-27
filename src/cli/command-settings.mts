import {
  assertOwner,
  assertRepo,
  resolveAnswers,
  resolveUpgrades,
  resolveApprovalCheck,
  resolveEvidence,
  resolveReferences,
  resolveRulePlugins,
  reviewSettings,
  settingLayers,
  settingsProblems,
} from '../review/index.mts'
import { modelTable } from '../review/models.mts'
import { analysisSummary } from '../review/analysis-settings.mts'
import { resolveModels } from '../review/models-settings.mts'
import { resolveLimits } from '../review/limits-settings.mts'
import { describePillars, resolvePillars } from '../review/pillars-settings.mts'
import { resolveTargets } from '../review/targets-settings.mts'
import { planSummary, resolvePlanValues } from '../review/plan-settings.mts'
import type { ReviewDeps } from './deps.mts'

/** The resolved settings of one repository or owner, the layer each came from, and the problems. */
export async function settings(
  values: { owner?: string | undefined; repo?: string[] | undefined },
  deps: ReviewDeps,
) {
  const repo = values.repo?.[0]
  if ((repo === undefined) === (values.owner === undefined)) {
    throw new Error('settings needs --repo or --owner.')
  }
  const scope = repo ?? (values.owner as string)
  if (repo === undefined) assertOwner(scope)
  else assertRepo(repo)
  const configs = deps.configs()
  const target = repo === undefined ? undefined : await deps.targetConfig(repo)
  const evidence = resolveEvidence(configs, scope, target?.config)
  const references = resolveReferences(configs, scope, target?.config)
  const models = resolveModels(configs, scope)
  const limits = resolveLimits(configs, scope)
  return {
    scope,
    ...reviewSettings(configs, scope, target?.config),
    from: settingLayers(configs, scope, target?.config),
    // Names only: a source's env values and commands stay out of any output.
    evidence: { sources: evidence.sources.map((source) => source.name), from: evidence.from },
    analysis: analysisSummary(configs, scope),
    references: {
      sources: references.sources.map(({ name, domains }) => ({ name, domains })),
      from: references.from,
    },
    approvalCheck: resolveApprovalCheck(configs, scope),
    answers: resolveAnswers(configs, scope),
    upgrades: resolveUpgrades(configs, scope),
    rulePlugins: resolveRulePlugins(configs, scope, target?.config),
    pillars: describePillars(resolvePillars(configs, scope, target?.config)),
    targets: resolveTargets(configs, scope, target?.config, deps.references()),
    plan: planSummary(resolvePlanValues(configs, scope, target?.config)),
    // What each step runs on; a pillar with no setting follows the plan (see docs/configuration.md).
    models: {
      steps: modelTable(models.plan),
      tiers: models.plan.tiers,
      retry: models.plan.retry,
      from: models.from,
    },
    limits,
    problems: [
      ...settingsProblems(configs, scope.split('/')[0] as string),
      ...(target?.problems ?? []),
    ],
  }
}
