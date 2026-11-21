import type { SanitizedReview } from '../review-payload/index.mts'
import type { ReviewInput } from './finding.mts'
import { narrationWarnings } from './narration.mts'

/** Targets in characters, not hard limits: over target warns, over three times refuses. */
export type TextLimits = { bodyTarget: number; inlineTarget: number }

export const DEFAULT_TEXT_LIMITS: TextLimits = { bodyTarget: 1_200, inlineTarget: 800 }

/** A post is refused at this multiple of a target unless it is allowed to be long. */
export const REFUSAL_FACTOR = 3

export type TextCheck = {
  /** Every text over its target, with its length. */
  warnings: string[]
  /** The subset over `REFUSAL_FACTOR` times the target. */
  tooLong: string[]
}

/** The reader's part of a review body: no hidden marker and no collapsed details. */
export function visibleBody(body: string): string {
  let depth = 0
  let shown = ''
  // A collapsed block ends at its matching close, so nested blocks do not end it early.
  for (const piece of body
    .replace(/<!--[\s\S]*?-->/gu, '')
    .split(/(<details[^>]*>|<\/details>)/iu)) {
    if (/^<details/iu.test(piece)) depth += 1
    else if (/^<\/details>/iu.test(piece)) depth = Math.max(0, depth - 1)
    else if (depth === 0) shown += piece
  }
  return shown
}

type Measured = { what: string; length: number; target: number }

function measure(reviews: readonly SanitizedReview[], limits: TextLimits): Measured[] {
  return reviews.flatMap((review, part) => [
    {
      what: `review body (part ${part + 1})`,
      length: visibleBody(review.body).trim().length,
      target: limits.bodyTarget,
    },
    ...review.comments.map((comment) => ({
      what: `inline comment on ${comment.path}:${comment.line}`,
      length: comment.body.length,
      target: limits.inlineTarget,
    })),
  ])
}

/**
 * Checks the posted text: length against the targets (the inline target counts the whole comment)
 * and review-process narration in the authored fields. Everything here warns; `tooLong` is what a
 * real post refuses without `--allow-long`.
 */
export function checkPostedText(
  input: ReviewInput,
  reviews: readonly SanitizedReview[],
  limits: TextLimits = DEFAULT_TEXT_LIMITS,
): TextCheck {
  const length = checkLength(reviews, limits)
  return {
    ...length,
    warnings: [...length.warnings, ...narrationWarnings(input), ...preventWarnings(input)],
  }
}

/** The prevention note is one short line; a longer one is a second finding, so it warns. */
export const PREVENT_TARGET = 160

function preventWarnings(input: ReviewInput): string[] {
  const note = input.regressionPrevent ?? ''
  return [
    ...(note.length > PREVENT_TARGET
      ? [`regressionPrevent is ${note.length} characters, over its ${PREVENT_TARGET} target`]
      : []),
    ...findingPreventWarnings(input),
  ]
}

function findingPreventWarnings(input: ReviewInput): string[] {
  return input.findings.flatMap((finding, at) =>
    (finding.prevent?.length ?? 0) > PREVENT_TARGET
      ? [
          `findings[${at}].prevent is ${finding.prevent?.length} characters, over its ${PREVENT_TARGET} target`,
        ]
      : [],
  )
}

function checkLength(reviews: readonly SanitizedReview[], limits: TextLimits): TextCheck {
  const over = measure(reviews, limits).filter((item) => item.length > item.target)
  const text = (item: Measured) =>
    `${item.what} is ${item.length} characters, over its ${item.target} target`
  return {
    warnings: over.map(text),
    tooLong: over.filter((item) => item.length > item.target * REFUSAL_FACTOR).map(text),
  }
}
