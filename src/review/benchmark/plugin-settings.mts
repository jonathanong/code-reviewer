import {
  DEFAULT_RULE_PLUGINS,
  parsePluginList,
  pluginLabels,
  pluginSettings,
  type Plugin,
} from '../plugins.mts'
import type { Exec } from './exec.mts'

export type BenchPlugins = {
  /** Enabled plugins and versions recorded with a run; `['unknown']` when they could not be listed. */
  labels: string[]
  /** The `--settings` object for the run, or undefined when the plugins could not be listed. */
  settings: object | undefined
  /** Every plugin off, for the judge, which needs none. */
  noPlugins: object | undefined
}

/**
 * Lists the enabled plugins once for a benchmark. A control run (`rules` false) records none and
 * switches every plugin off, so a score change can be traced to the rule plugins alone.
 */
export async function benchPlugins(
  exec: Exec,
  cwd: string,
  rules: boolean,
  log: (line: string) => void,
): Promise<BenchPlugins> {
  let listed: Plugin[]
  try {
    listed = parsePluginList(await exec('claude', ['plugin', 'list', '--json']), cwd)
  } catch (error) {
    log(`plugins: ${error instanceof Error ? error.message : String(error)}`)
    return { labels: rules ? ['unknown'] : [], settings: undefined, noPlugins: undefined }
  }
  return {
    labels: rules ? pluginLabels(listed) : [],
    settings: pluginSettings(listed, DEFAULT_RULE_PLUGINS, rules),
    noPlugins: pluginSettings(listed, DEFAULT_RULE_PLUGINS, false),
  }
}
