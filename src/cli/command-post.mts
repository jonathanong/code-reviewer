import {
  completeReview,
  parseReviewInput,
  postFinalReview,
  postedStep,
  type PostOutcome,
  type PullTarget,
  type ReviewInput,
  type ReviewIo,
} from '../review/index.mts'
import type { TextLimits } from '../review/concise.mts'
import { savePostedFindings } from '../tracker/posted-file.mts'
import { recordPosted } from '../tracker/record.mts'
import type { ReviewDeps } from './deps.mts'
import { answersFor } from './post-answers.mts'
import { requireValidConfig } from './config-check.mts'
import { postOptions, type PostValues } from './post-options.mts'
import { checkRunFor, labelsFor } from './review-settings.mts'

export type PostCommandValues = PostValues & {
  'head-sha'?: string | undefined
  input?: string | undefined
  'dry-run'?: boolean | undefined
}

export type PostResult = {
  outcome: PostOutcome
  /** What `post` prints; a dry run prints the outcome alone. */
  printed: Record<string, unknown>
}

const withoutPlacements = ({ placements: _placements, ...rest }: PostOutcome) => rest

export type PreparedPost = {
  pull: PullTarget
  deps: ReviewDeps
  io: ReviewIo
  headSha: string
  input: ReviewInput
  dryRun: boolean
  /** Path to the review input JSON when posting from a run directory; absent for carried reviews. */
  inputPath?: string
  allowLong?: boolean
  textLimits?: TextLimits
  author?: string
}

/**
 * Shared posting path for `post` and `carry`: posts the review (or previews on dry run), moves
 * labels, completes the check run, records the tracker row, saves per-finding placements when a
 * run directory exists, and posts any thread answers.
 */
export async function postPreparedReview(args: PreparedPost): Promise<PostResult> {
  const { pull, deps, io, headSha, input, dryRun, inputPath, allowLong, textLimits, author } = args
  const outcome = await postFinalReview(io, input, headSha, {
    dryRun,
    ...(allowLong === undefined ? {} : { allowLong }),
    ...(textLimits === undefined ? {} : { textLimits }),
    ...(author === undefined ? {} : { author }),
  })
  if (dryRun) return { outcome, printed: withoutPlacements(outcome) }
  const lifecycle = await completeReview(deps.createLabelIo(pull), await labelsFor(deps, pull.repo))
  const checkRun = await checkRunFor(deps, pull, postedStep(outcome.verdict, outcome.urls), headSha)
  const tracked = recordPosted(deps.tracker(), {
    ...pull,
    headSha,
    ...(inputPath === undefined ? {} : { input: inputPath }),
    findings: input.findings,
    outcome,
  })
  const saved =
    inputPath === undefined
      ? {}
      : savePostedFindings(
          (path, text) => deps.writeFile(path, text),
          inputPath,
          headSha,
          input.findings,
          outcome.placements,
        )
  const answered = await answersFor(deps, pull, input, () => io.trustedAuthors(), outcome.confirmed)
  const problems = [saved.trackerProblem, tracked.trackerProblem].filter((p) => p !== undefined)
  const printed = {
    ...withoutPlacements(outcome),
    reviews: outcome.reviews.length,
    lifecycle,
    ...answered,
    checkRun,
    ...(problems.length === 0 ? {} : { trackerProblem: problems.join('; ') }),
  }
  return { outcome, printed }
}

/** `code-reviewer post`: renders and posts `--input` on `--head-sha`, then closes the labels and the tracker row. */
export async function postCommand(
  values: PostCommandValues,
  pull: PullTarget,
  deps: ReviewDeps,
): Promise<PostResult> {
  if (values['head-sha'] === undefined || values.input === undefined) {
    throw new Error('post needs --head-sha and --input.')
  }
  const headSha = values['head-sha']
  const input = parseReviewInput(JSON.parse(deps.readFile(values.input)) as unknown)
  await requireValidConfig(deps, pull.repo)
  return postPreparedReview({
    pull,
    deps,
    io: deps.createIo(pull),
    headSha,
    input,
    dryRun: values['dry-run'] === true,
    inputPath: values.input,
    ...postOptions(values, (path) => deps.readFile(path), values.input, headSha),
  })
}
