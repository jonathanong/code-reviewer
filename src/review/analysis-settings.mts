import type { AnalysisTool } from './rules/analysis-parse.mts'
import type { RepoConfigs } from './rules/config.mts'
import { machineSetting, type MachineLayer } from './settings.mts'

export type AnalysisSettings = {
  tools: AnalysisTool[]
  /** The machine layer whose list applies; null when none sets one. */
  from: MachineLayer
}

/** The analysis tools for `owner/name` (or `owner`); a pull request's repository cannot grant the reviewer commands. */
export function resolveAnalysis(configs: RepoConfigs, scope: string): AnalysisSettings {
  const { value, from } = machineSetting(configs, scope, 'analysis')
  return { tools: value ?? [], from }
}

/** What `settings` prints: the tool names only, never the commands, and the layer that set them. */
export function analysisSummary(configs: RepoConfigs, scope: string) {
  const { tools, from } = resolveAnalysis(configs, scope)
  return { tools: tools.map((tool) => tool.name), from }
}
