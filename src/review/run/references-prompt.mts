import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { StepModels } from '../models.mts'
import type { ReferenceSource } from '../rules/references-parse.mts'

/**
 * The configured web references and the rules for using them (`web-references.md`). A run gets this
 * only when a machine config lists references; without it no prompt or flag changes.
 */
export type WebReferences = { sources: readonly ReferenceSource[]; guidance: string }

/** The references and their rules read from `dir`; undefined, and no file read, when none. */
export function webReferences(
  dir: string,
  sources: readonly ReferenceSource[] = [],
): WebReferences | undefined {
  if (sources.length === 0) return undefined
  return { sources, guidance: readFileSync(join(dir, 'web-references.md'), 'utf8') }
}

/** Every host the references allow, once each. */
export function referenceDomains(web: WebReferences | undefined): string[] {
  return [...new Set((web?.sources ?? []).flatMap((source) => source.domains))]
}

/** The step models with the review's reference hosts, which every step's request then carries. */
export function withReferenceDomains(
  models: StepModels,
  web: WebReferences | undefined,
): StepModels {
  return { ...models, referenceDomains: referenceDomains(web) }
}

/** The "References" block of a correctness or verifier prompt; empty without references. */
export function referencesBlock(web: WebReferences | undefined): string[] {
  if (web === undefined || web.sources.length === 0) return []
  const lines = web.sources.map(
    (source) => `- ${source.name}: ${source.description} (${source.domains.join(', ')})`,
  )
  return [
    [
      '## References',
      'You have the WebFetch tool for these hosts only; a fetch of any other host is denied.',
      lines.join('\n'),
      web.guidance.trim(),
    ].join('\n\n'),
  ]
}
