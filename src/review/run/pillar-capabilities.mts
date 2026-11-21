import { READ_ONLY, type Capabilities } from '../../harness/types.mts'
import type { Pillar } from '../pillar-name.mts'

/** The pillars that may look things up in the configured web references. */
export const WEB_PILLARS: readonly Pillar[] = ['correctness', 'security']

/** The history pillar reads git history through the shell, and nothing else. */
export const HISTORY_COMMANDS: readonly string[] = ['git log', 'git show']

/**
 * What a pillar run may do, shared by `review` and `bench` so a bench run grants exactly what a
 * real review does. Pillars read files, hand exploration to the explorer, and load installed rule
 * skills; `skills: false` is a control run without them.
 */
export function pillarCapabilities(
  pillar: Pillar,
  skills = true,
  domains: readonly string[] = [],
): Capabilities {
  const base = { ...READ_ONLY, explorer: true, skills }
  if (pillar === 'history') return { ...base, shell: HISTORY_COMMANDS }
  // Only the correctness and security pillars look things up on the web.
  return WEB_PILLARS.includes(pillar) ? { ...base, web: domains } : base
}

/** The verifier and the approval check read files and may load rule skills, but dispatch nothing. */
export const SKILL_READER: Capabilities = { ...READ_ONLY, skills: true }

/** The evidence run reads files and runs only the configured command prefixes. */
export function evidenceCapabilities(prefixes: readonly string[]): Capabilities {
  return { ...READ_ONLY, shell: prefixes }
}
