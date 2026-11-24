import { createHash } from 'node:crypto'

import type { EvalCase } from './cases.mts'
import { caseRevision } from './fixture.mts'
import type { VerifierInput } from './verifier-input.mts'

export type VerifierRun = {
  verifierPrompt: string
  model: string
  maxTurns: number
  /** The `pluginSettings` object limiting the run to the rule plugins; omitted when unknown. */
  settings?: object
}

/** Identifies everything a verifier output depends on, including the staged rules' digest. */
export function verifierRunInputs(
  item: EvalCase,
  input: VerifierInput,
  run: VerifierRun,
  rules: string,
): string {
  const payload = JSON.stringify({
    ...caseRevision(item),
    input,
    run,
    rules,
    answerable: item.answerable,
    verifierFocus: item.verifierFocus,
  })
  return createHash('sha256').update(payload).digest('hex')
}
