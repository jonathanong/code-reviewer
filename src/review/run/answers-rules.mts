import { readFileSync } from 'node:fs'

import type { PluginInstall } from '../plugins.mts'
import type { AnswerRules } from './answers-prompt.mts'
import { pluginRepository, skillUrl } from './answers-links.mts'
import { normalizeLines } from './answers-quote.mts'
import { listRuleSkillFiles } from './select-skills.mts'

/**
 * The installed rule skills an answer may cite, with their text and links. An answer cites a skill the run
 * selected or the verifier loaded, so only installed skills of the configured rule plugins count.
 * A skill that cannot be read is left out, so no answer can quote it.
 */
export function answerRules(
  installs: readonly PluginInstall[],
  rulePlugins: readonly string[],
  selected: readonly string[],
): AnswerRules {
  const texts = new Map<string, string>()
  const links = new Map<string, string>()
  const repositories = new Map<string, string | undefined>()
  for (const skill of listRuleSkillFiles(installs, rulePlugins, [])) {
    try {
      texts.set(skill.name, normalizeLines(readFileSync(skill.file, 'utf8')))
      const plugin = skill.name.split(':')[0] as string
      if (!repositories.has(plugin)) {
        const install = installs.find((candidate) => candidate.name === plugin) as PluginInstall
        repositories.set(plugin, pluginRepository(install.installPath))
      }
      const url = skillUrl(repositories.get(plugin), skill.file)
      if (url !== undefined) links.set(skill.name, url)
    } catch {
      // A skill that cannot be read cannot be quoted.
    }
  }
  return { texts, selected, links }
}

/** The verifier option holding the citable rule skills; nothing when the answers setting is off. */
export function answerOptions(
  steps: { answers?: boolean; rulePlugins: readonly string[] },
  installs: readonly PluginInstall[],
  selected: readonly string[],
): { answerRules?: AnswerRules } {
  return steps.answers === true
    ? { answerRules: answerRules(installs, steps.rulePlugins, selected) }
    : {}
}
