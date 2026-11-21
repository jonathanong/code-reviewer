import { parseIssues } from '../../issues/config-parse.mts'
import { parseEvidence } from './evidence-parse.mts'
import { parseLimits } from './limits-parse.mts'
import { machineOnly } from './machine-only.mts'
import { parseModels } from './models-parse.mts'
import { parseReferences } from './references-parse.mts'
import { parseRulePlugins } from './rule-plugins-parse.mts'
import { parseRun } from './run-parse.mts'
import { parseSwitch } from './settings-parse.mts'
import type { RepoConfig } from './config.mts'

type Json = Record<string, unknown>

type MachineKeys = Pick<
  RepoConfig,
  | 'trustRepoConfig'
  | 'evidence'
  | 'references'
  | 'approvalCheck'
  | 'rulePlugins'
  | 'run'
  | 'models'
  | 'limits'
  | 'issues'
>

/**
 * The keys only machine files may set. In the reviewed repository's own file (`target`) each is
 * ignored with a problem naming the file. A `trusted` repository file (the machine config sets
 * `trustRepoConfig` for it) may also set `evidence`, `references` and `rulePlugins`, parsed as in a
 * machine file. A key left out of the result was absent or invalid.
 */
export function parseMachineKeys(
  fileScope: 'repo' | 'owner' | 'target' | 'trusted',
  raw: Json,
  file: string,
  problems: string[],
): MachineKeys {
  const scope = fileScope === 'trusted' ? 'target' : fileScope
  const grantScope = fileScope === 'trusted' ? 'repo' : fileScope
  const trustRepoConfig = machineOnly(
    scope,
    raw.trustRepoConfig,
    file,
    'trustRepoConfig',
    problems,
    {
      what: 'trustRepoConfig is',
      parse: parseSwitch,
    },
  )
  const evidence = machineOnly(grantScope, raw.evidence, file, 'evidence', problems, {
    what: 'evidence sources are',
    parse: parseEvidence,
  })
  const references = machineOnly(grantScope, raw.references, file, 'references', problems, {
    what: 'references are',
    parse: parseReferences,
  })
  const approvalCheck = machineOnly(scope, raw.approvalCheck, file, 'approvalCheck', problems, {
    what: 'approvalCheck is',
    parse: parseSwitch,
  })
  const rulePlugins = machineOnly(grantScope, raw.rulePlugins, file, 'rulePlugins', problems, {
    what: 'rulePlugins is',
    parse: parseRulePlugins,
  })
  const run = machineOnly(scope, raw.run, file, 'run', problems, {
    what: 'run settings are',
    parse: parseRun,
  })
  const models = machineOnly(scope, raw.models, file, 'models', problems, {
    what: 'models is',
    parse: parseModels,
  })
  const limits = machineOnly(scope, raw.limits, file, 'limits', problems, {
    what: 'limits is',
    parse: parseLimits,
  })
  const issues = machineOnly(scope, raw.issues, file, 'issues', problems, {
    what: 'issues is',
    parse: parseIssues,
  })
  return {
    ...(trustRepoConfig === undefined ? {} : { trustRepoConfig }),
    ...(evidence === undefined ? {} : { evidence }),
    ...(references === undefined ? {} : { references }),
    ...(approvalCheck === undefined ? {} : { approvalCheck }),
    ...(rulePlugins === undefined ? {} : { rulePlugins }),
    ...(run === undefined ? {} : { run }),
    ...(models === undefined ? {} : { models }),
    ...(limits === undefined ? {} : { limits }),
    ...(issues === undefined ? {} : { issues }),
  }
}
