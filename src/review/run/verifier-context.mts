import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Answerable } from '../context/answerable.mts'
import type { Restatable } from '../context/restatable.mts'
import { threadIdsOf } from './review-support.mts'

/** The other reviewers' open blocking or high items `prepare` recorded; none in an older run. */
export function restatableOf(out: string): Restatable[] {
  const { restatable } = JSON.parse(readFileSync(join(out, 'context.json'), 'utf8')) as {
    restatable?: unknown
  }
  return Array.isArray(restatable) ? (restatable as Restatable[]) : []
}

/** The other reviewers' open notes `prepare` recorded; none in an older run. */
export function answerableOf(out: string): Answerable[] {
  const { answerable } = JSON.parse(readFileSync(join(out, 'context.json'), 'utf8')) as {
    answerable?: unknown
  }
  return Array.isArray(answerable) ? (answerable as Answerable[]) : []
}

/**
 * The lists the verifier input takes from the run directory, apart from the findings. The notes to
 * answer are read only when the answers setting is on.
 */
export function verifierContext(
  out: string,
  answers = false,
): { threads: string[]; restate: Restatable[]; answerable?: Answerable[] } {
  return {
    threads: threadIdsOf(out),
    restate: restatableOf(out),
    ...(answers ? { answerable: answerableOf(out) } : {}),
  }
}
