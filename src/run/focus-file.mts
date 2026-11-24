import { readFileSync } from 'node:fs'

import { MAX_FOCUS_CHARS, MAX_FOCUS_POINTS } from '../review/focus.mts'

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
  const points = raw
    .split(/\r?\n/u)
    .map((line) =>
      line
        .trim()
        .replace(/^-(\s+|$)/u, '')
        .trim(),
    )
    .filter((line) => line !== '')
  if (points.length === 0) throw new Error(`--focus ${path}: the file has no focus points.`)
  if (points.length > MAX_FOCUS_POINTS) {
    throw new Error(`--focus ${path}: ${points.length} points; at most ${MAX_FOCUS_POINTS}.`)
  }
  const long = points.findIndex((point) => point.length > MAX_FOCUS_CHARS)
  if (long !== -1) {
    throw new Error(`--focus ${path}: point ${long + 1} is over ${MAX_FOCUS_CHARS} characters.`)
  }
  return points
}
