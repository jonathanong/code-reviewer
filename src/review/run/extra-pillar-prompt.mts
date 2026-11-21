import type { ExtraPillarConfig } from '../rules/pillars-parse.mts'
import { buildPillarRunPrompt, type PillarPromptInput } from './pillar-prompt.mts'

/**
 * The prompt of a configured pillar. A `run` command is the whole prompt, followed by the output
 * contract. Instructions go where a built-in pillar file does, behind the trigger when the pillar
 * has one: the pillar itself decides whether it applies, so the trigger costs no extra model call.
 */
export function buildExtraPillarPrompt(
  extra: ExtraPillarConfig,
  input: Omit<PillarPromptInput, 'pillarText'>,
): string {
  if ('run' in extra.source) return [extra.source.run, input.contract.trim()].join('\n\n')
  const trigger =
    extra.when === undefined
      ? []
      : [
          `This pillar applies only when: ${extra.when}`,
          'If that does not apply to this change, return an empty findings array and stop.',
        ]
  const pillarText = [`# Pillar: ${extra.name}`, ...trigger, extra.source.prompt].join('\n\n')
  return buildPillarRunPrompt({ ...input, pillarText })
}
