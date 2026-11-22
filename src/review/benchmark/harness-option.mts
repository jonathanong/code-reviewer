import { harness as claude } from '../../harness/claude.mts'
import { HarnessRefusal } from '../../harness/refusal.mts'
import { HARNESS_NAMES, harnessNamed } from '../../harness/registry.mts'
import { EFFORT } from '../../harness/types.mts'
import type { Pillar } from '../pillar-name.mts'
import { pillarCapabilities } from '../run/pillar-capabilities.mts'
import { PILLAR_OUTPUT_SCHEMA } from '../run/pillar-schema.mts'

/** The harness name to record on a row: undefined for Claude, so a Claude row reads as it always did. */
export function otherHarness(name: string | undefined): string | undefined {
  return name === undefined || name === claude.name ? undefined : name
}

/**
 * Checks `bench --harness` before any work: the name is registered, `--model` is given, and the
 * adapter accepts every pillar's capabilities. A configuration problem names the flag or pillar.
 */
export function assertPillarHarness(
  values: { harness?: string; model?: string; 'reads-outside-checkout'?: boolean },
  pillars: readonly Pillar[],
  skills: boolean,
): void {
  const named = values.harness
  if (named === undefined) {
    if (values['reads-outside-checkout'] === true)
      throw new Error('bench --reads-outside-checkout needs --harness.')
    return
  }
  const adapter = harnessNamed(named)
  if (adapter === undefined)
    throw new Error(
      `bench --harness: unknown harness "${named}"; use one of ${HARNESS_NAMES.join(', ')}.`,
    )
  if (adapter.name === claude.name) {
    if (values['reads-outside-checkout'] === true)
      throw new Error('bench --reads-outside-checkout applies to a non-Claude --harness.')
    return
  }
  if (values.model === undefined)
    throw new Error(`bench --harness ${named} needs --model, that harness's model id.`)
  for (const pillar of pillars) {
    try {
      adapter.assertCan?.({
        prompt: '',
        label: 'Pillar run',
        model: values.model,
        maxTurns: 1,
        schema: PILLAR_OUTPUT_SCHEMA,
        can: pillarCapabilities(pillar, skills),
        effort: EFFORT.full,
        ...(values['reads-outside-checkout'] === true ? { readsOutsideCheckout: true } : {}),
      })
    } catch (error) {
      // `assertCan` throws nothing but a refusal.
      throw new Error(
        `bench --harness ${named} cannot run the ${pillar} pillar: ${(error as HarnessRefusal).message}`,
        {
          cause: error,
        },
      )
    }
  }
}
