import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Restatable } from '../context/restatable.mts'
import { threadIdsOf } from './review-support.mts'

/** The other reviewers' open blocking or high items `prepare` recorded; none in an older run. */
export function restatableOf(out: string): Restatable[] {
  const { restatable } = JSON.parse(readFileSync(join(out, 'context.json'), 'utf8')) as {
    restatable?: unknown
  }
  return Array.isArray(restatable) ? (restatable as Restatable[]) : []
}

/** The lists the verifier input takes from the run directory, apart from the findings. */
export function verifierContext(out: string): { threads: string[]; restate: Restatable[] } {
  return { threads: threadIdsOf(out), restate: restatableOf(out) }
}
