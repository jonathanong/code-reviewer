import {
  SPLIT_MIN_LINES,
  SPLIT_MIN_MECHANICAL_FILES,
  SPLIT_MIN_MECHANICAL_LINES,
  SPLIT_MIN_MECHANICAL_SHARE,
  SPLIT_MIN_REMAINDER_LINES,
  SPLIT_MIN_REMAINDER_SHARE,
  SPLIT_MIN_WHITESPACE_LINES,
} from './analyze.mts'
import type { ChangeShape, Hunk } from './types.mts'

const CLIP = 100

/** One part of the diff that is mechanical; `lines` is 0 for a pure rename. */
export type MechanicalPart = { what: string; files: number; lines: number }

/** What the verifier is told about a large change that mixes a mechanical part with the rest. */
export type SplitSummary = {
  files: number
  /** Added and deleted lines outside generated files. */
  lines: number
  /** At least this many lines and files are mechanical. */
  mechanical: { lines: number; files: number; parts: MechanicalPart[] }
  /** Config changes that may explain the mechanical part, as `path: key, key`. */
  explainedBy: string[]
  /** At most this many lines are not. */
  remainder: { lines: number }
}

const clip = (text: string): string => (text.length > CLIP ? `${text.slice(0, CLIP)}...` : text)

const edit = (hunk: Hunk): string =>
  `the same edit repeated, e.g. \`${clip(hunk.removed[0]?.trim() ?? '')}\` -> \`${clip(hunk.added[0]?.trim() ?? '')}\``

/**
 * The summary when the change is large and has both a substantial mechanical part and a substantial
 * remainder; null otherwise, so a purely mechanical change, one with nothing mechanical, one that
 * is merely big, and one whose analysis hit a cap all get no proposal. Every number errs toward no
 * proposal. Repeated edits and whitespace-only lines may cover the same lines or different ones, so
 * the larger stands as "at least" the mechanical lines and files, while the remainder subtracts
 * their sum (counting an overlap twice only shrinks it): "at most" the lines that are not.
 */
export function splitSummary(shape: ChangeShape): SplitSummary | null {
  const total = shape.reviewableLines
  if (shape.truncated) return null
  const mechanicalLines = Math.min(total, Math.max(shape.repeatedLines, shape.whitespace.lines))
  const mechanicalFiles = Math.max(shape.repeatedFiles, shape.whitespace.files)
  const remainder = total - Math.min(total, shape.repeatedLines + shape.whitespace.lines)
  const worthIt =
    total >= SPLIT_MIN_LINES &&
    mechanicalLines >= SPLIT_MIN_MECHANICAL_LINES &&
    mechanicalLines >= total * SPLIT_MIN_MECHANICAL_SHARE &&
    mechanicalFiles >= SPLIT_MIN_MECHANICAL_FILES &&
    remainder >= SPLIT_MIN_REMAINDER_LINES &&
    remainder >= total * SPLIT_MIN_REMAINDER_SHARE
  if (!worthIt) return null
  const parts: MechanicalPart[] = [
    ...shape.top.map((group) => ({
      what: edit(group.example),
      files: group.files,
      lines: group.lines,
    })),
    ...(shape.whitespace.lines >= SPLIT_MIN_WHITESPACE_LINES
      ? [
          {
            what: 'whitespace-only changes',
            files: shape.whitespace.files,
            lines: shape.whitespace.lines,
          },
        ]
      : []),
    ...(shape.renames > 0 ? [{ what: 'pure renames', files: shape.renames, lines: 0 }] : []),
  ]
  const explainedBy = shape.configs.flatMap((config) =>
    config.keys === null || config.keys.length === 0
      ? []
      : [`${config.path}: ${config.keys.join(', ')}${config.moreKeys > 0 ? ', ...' : ''}`],
  )
  return {
    files: shape.files,
    lines: total,
    mechanical: { lines: mechanicalLines, files: mechanicalFiles, parts },
    explainedBy,
    remainder: { lines: remainder },
  }
}
