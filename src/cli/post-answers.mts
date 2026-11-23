import { postAnswers, type AnswersOutcome } from '../review/answers-post.mts'
import type { ReviewInput } from '../review/finding.mts'
import { resolveAnswers } from '../review/settings.mts'
import type { PullTarget } from '../review/target.mts'
import type { TrustedAuthors } from '../review/trust.mts'
import type { ReviewDeps } from './deps.mts'

/**
 * Replies to the threads the review answers, once it is posted. Nothing is posted when the
 * answers setting is off, whatever `review.json` holds; the output then says so. Absent when the
 * input has no answers.
 */
export async function answersFor(
  deps: ReviewDeps,
  pull: PullTarget,
  input: ReviewInput,
  trusted: () => Promise<TrustedAuthors>,
): Promise<{ answers: AnswersOutcome | { off: true } } | Record<string, never>> {
  if (input.answers === undefined || input.answers.length === 0) return {}
  if (!resolveAnswers(deps.configs(), pull.repo).enabled) return { answers: { off: true } }
  return { answers: await postAnswers(deps.createAnswerIo(pull), await trusted(), input.answers) }
}
