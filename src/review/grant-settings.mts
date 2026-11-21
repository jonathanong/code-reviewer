import { DEFAULT_RULE_PLUGINS } from './plugins.mts'
import type { RepoConfig, RepoConfigs } from './rules/config.mts'
import type { EvidenceSource } from './rules/evidence-parse.mts'
import type { ReferenceSource } from './rules/references-parse.mts'
import { candidates, machineSetting, type MachineLayer } from './settings.mts'

/** Where a value that a trusted repository's own file may also set came from. */
export type GrantLayer = MachineLayer | 'repository file'

type Grantable = 'evidence' | 'references' | 'rulePlugins'

/**
 * One key a repository's own file may set only when a machine layer sets `trustRepoConfig` for it:
 * the highest layer that sets it wins, the machine repo file, the machine owner file, then the
 * repository's own file, the same order as `reviewSettings`. Without trust `target` is not consulted.
 */
function grantableSetting<K extends Grantable>(
  configs: RepoConfigs,
  scope: string,
  key: K,
  target: RepoConfig | undefined,
): { value: RepoConfig[K] | undefined; from: GrantLayer } {
  const trusted = trustsRepoConfig(configs, scope)
  const [layer, config] = candidates(configs, scope, trusted ? target : undefined).find(
    ([, candidate]) => candidate?.[key] !== undefined,
  ) ?? [null, undefined]
  return { value: config?.[key], from: layer }
}

export type EvidenceSettings = {
  sources: EvidenceSource[]
  /** The layer whose list applies; null when none sets one. */
  from: GrantLayer
}

/**
 * The evidence sources for `owner/name` (or `owner`). A pull request's repository cannot grant the
 * reviewer commands unless a machine layer sets `trustRepoConfig`; then pass its file as `target`.
 */
export function resolveEvidence(
  configs: RepoConfigs,
  scope: string,
  target?: RepoConfig,
): EvidenceSettings {
  const { value, from } = grantableSetting(configs, scope, 'evidence', target)
  return { sources: value ?? [], from }
}

export type ReferenceSettings = {
  sources: ReferenceSource[]
  /** The layer whose list applies; null when none sets one. */
  from: GrantLayer
}

/**
 * The web references for `owner/name` (or `owner`). A pull request's repository cannot grant the
 * reviewer network access unless a machine layer sets `trustRepoConfig`; then pass its file as `target`.
 */
export function resolveReferences(
  configs: RepoConfigs,
  scope: string,
  target?: RepoConfig,
): ReferenceSettings {
  const { value, from } = grantableSetting(configs, scope, 'references', target)
  return { sources: value ?? [], from }
}

export type RulePluginSettings = {
  /** Plugin names, the part before `@`; empty means repository rules only. */
  names: readonly string[]
  /** The layer whose list applies; null when none sets one, which leaves the defaults. */
  from: GrantLayer
}

/**
 * The plugins whose skills hold the shared rules: the highest layer that sets `rulePlugins`
 * replaces the defaults whole, and an empty list is a value, not an absence. The repository's own
 * file (`target`) counts only when a machine layer sets `trustRepoConfig`.
 */
export function resolveRulePlugins(
  configs: RepoConfigs,
  scope: string,
  target?: RepoConfig,
): RulePluginSettings {
  const { value, from } = grantableSetting(configs, scope, 'rulePlugins', target)
  return { names: value ?? DEFAULT_RULE_PLUGINS, from }
}

/** Whether a machine layer lets this repository's own file set `evidence`, `references` and `rulePlugins`. */
export function trustsRepoConfig(configs: RepoConfigs, scope: string): boolean {
  return machineSetting(configs, scope, 'trustRepoConfig').value === true
}
