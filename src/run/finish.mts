import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PullTarget } from '../review/index.mts'
import { abortCommand } from '../cli/command-loop.mts'
import { explainCommand } from '../cli/command-tracker.mts'
import type { ReviewDeps } from '../cli/deps.mts'

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function quote(text: string): string {
  return /^[\w./:=@-]+$/u.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`
}

/** The command a human runs to post the review a run left in `runDir`. */
export function postText(pull: PullTarget, headSha: string, runDir: string): string {
  const input = quote(join(runDir, 'review.json'))
  return `code-reviewer post --repo ${pull.repo} --pr ${pull.pr} --head-sha ${headSha} --input ${input}`
}

/**
 * Drops the in-progress label. `requeue` puts the request label back, which is how a held review
 * stays visible without passing `status`. Returns a problem when the labels could not be changed.
 */
export async function release(
  pull: PullTarget,
  deps: ReviewDeps,
  requeue: boolean,
): Promise<string | undefined> {
  try {
    await abortCommand({ requeue }, () => pull, deps)
    return undefined
  } catch (error) {
    return `could not release the claim: ${message(error)}`
  }
}

/** Writes the explainer beside the run's files; a failure is a problem, not a failed run. */
export function writeExplain(
  deps: ReviewDeps,
  runDir: string,
): { path: string | null; problem?: string } {
  try {
    const path = join(runDir, 'explain.md')
    writeFileSync(path, explainCommand({ run: runDir }, deps.tracker()))
    return { path }
  } catch (error) {
    return { path: null, problem: `could not write the explainer: ${message(error)}` }
  }
}
