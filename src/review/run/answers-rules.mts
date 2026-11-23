import { readFileSync } from 'node:fs'

import { normalizeSpace } from '../answers.mts'
import type { PluginInstall } from '../plugins.mts'
import type { AnswerRules } from './answers-prompt.mts'
import { listRuleSkillFiles } from './select-skills.mts'

/**
 * The installed rule skills an answer may cite, with their text. An answer cites a skill the run
 * selected or the verifier loaded, so only installed skills of the configured rule plugins count.
 * A skill that cannot be read is left out, so no answer can quote it.
 */
export function answerRules(
  installs: readonly PluginInstall[],
  rulePlugins: readonly string[],
  selected: readonly string[],
): AnswerRules {
  const texts = new Map<string, string>()
  for (const skill of listRuleSkillFiles(installs, rulePlugins, [])) {
    texts.set(skill.name, normalizeSpace(readFileSync(skill.file, 'utf8')))
  }
  return { texts, selected }
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
