import { readFileSync } from 'node:fs'

import { charLength, MAX_FOCUS_CHARS, MAX_FOCUS_POINTS } from '../review/focus.mts'

/**
 * The points in a `--focus` file: one per non-empty line, a leading `- ` stripped. Throws a message
 * that names the file when it cannot be read, holds no point, or holds more or longer ones than a
 * review checks.
 */
export function readFocusFile(path: string): string[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    throw new Error(`--focus ${path}: cannot read the file (${(error as Error).message}).`, {
      cause: error,
    })
  }
  const entries = raw
    .split(/\r?\n/u)
    .map((line, index) => ({
      line: index + 1,
      point: line
        .trim()
        .replace(/^-(\s+|$)/u, '')
        .trim(),
    }))
    .filter((entry) => entry.point !== '')
  return checkFocusPoints(entries, `--focus ${path}`, 'the file has no focus points')
}

/**
 * Applies the limits of a review to points read from `source` (each with the line it came from)
 * and returns the points. Throws a message that starts with `source` when there is none, too many,
 * or one is too long: the one rule for a `--focus` file and for a check list read from a request.
 */
export function checkFocusPoints(
  entries: readonly { line: number; point: string }[],
  source: string,
  none: string,
): string[] {
  if (entries.length === 0) throw new Error(`${source}: ${none}.`)
  if (entries.length > MAX_FOCUS_POINTS) {
    throw new Error(`${source}: ${entries.length} points; at most ${MAX_FOCUS_POINTS}.`)
  }
  for (const entry of entries) {
    const length = charLength(entry.point)
    if (length > MAX_FOCUS_CHARS) {
      throw new Error(
        `${source}: line ${entry.line} is ${length} characters; at most ${MAX_FOCUS_CHARS}.`,
      )
    }
  }
  return entries.map((entry) => entry.point)
}
