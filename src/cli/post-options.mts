import { dirname, join } from 'node:path'

import { DEFAULT_TEXT_LIMITS, type TextLimits } from '../review/concise.mts'

export type PostValues = {
  'allow-long'?: boolean | undefined
  'body-target'?: string | undefined
  'inline-target'?: string | undefined
}

function positiveInt(value: string | undefined, name: string, fallback: number): number {
  if (value === undefined) return fallback
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`--${name} must be a positive integer.`)
  }
  return count
}

/**
 * The pull request author that `prepare` wrote beside `review.json`. Only a context for the same
 * head counts; anything else (no file, no author, another head) returns nothing, and `post` asks
 * the host instead.
 */
export function localAuthor(
  readFile: (path: string) => string,
  input: string,
  headSha: string,
): { author?: string } {
  try {
    const context = JSON.parse(readFile(join(dirname(input), 'context.json'))) as {
      author?: unknown
      headSha?: unknown
    }
    const { author } = context
    return context.headSha === headSha && typeof author === 'string' && author !== ''
      ? { author }
      : {}
  } catch {
    return {}
  }
}

/** The options of `postFinalReview` that come from the command line and the run directory. */
export function postOptions(
  values: PostValues,
  readFile: (path: string) => string,
  input: string,
  headSha: string,
): { allowLong: boolean; textLimits: TextLimits; author?: string } {
  return {
    allowLong: values['allow-long'] === true,
    textLimits: {
      bodyTarget: positiveInt(values['body-target'], 'body-target', DEFAULT_TEXT_LIMITS.bodyTarget),
      inlineTarget: positiveInt(
        values['inline-target'],
        'inline-target',
        DEFAULT_TEXT_LIMITS.inlineTarget,
      ),
    },
    ...localAuthor(readFile, input, headSha),
  }
}
