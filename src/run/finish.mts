import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PostOutcome, PullTarget } from '../review/index.mts'
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
 * Drops the in-progress label. `hold` sets the held label, so a review waiting for a person stays
 * visible in `queue` but no machine claims it; a request label would be read as a fresh request.
 * Returns a problem when the labels could not be changed.
 */
export async function release(
  pull: PullTarget,
  deps: ReviewDeps,
  how: 'hold' | 'drop',
): Promise<string | undefined> {
  try {
    await abortCommand({ hold: how === 'hold' }, () => pull, deps)
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

/**
 * The post warnings a person should look at. Wording warnings are for whoever tunes the reviewer,
 * not a reason to open this pull request, so they stay out of `attention`.
 */
export function worthALook(outcome: Pick<PostOutcome, 'warnings' | 'textWarnings'>): string[] {
  return outcome.warnings.filter((warning) => !outcome.textWarnings.includes(warning))
}
