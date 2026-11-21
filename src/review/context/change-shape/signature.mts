import type { Hunk, SignatureGroup } from './types.mts'

const KEYWORDS: ReadonlySet<string> = new Set(
  (
    'let const var function return if else for while do switch case break continue import export from as ' +
    'default class extends new typeof instanceof void async await try catch finally throw true false null ' +
    'undefined this fn pub use mod impl struct enum match def self None True False in of'
  ).split(' '),
)

/** A string, a number, or an identifier; one pass so placeholders are never rescanned. */
const TOKEN_RE =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\d[\w.]*)|([A-Za-z_$][\w$]*)/gu

/** Lines of one side kept in a signature; a longer hunk is told apart by its first lines. */
const SIDE_LINES = 8

/** Replaces literals and identifiers (not keywords) with placeholders and collapses whitespace. */
export function normalizeLine(line: string): string {
  return line
    .replace(TOKEN_RE, (word, text: string | undefined, num: string | undefined) => {
      if (text !== undefined) return 'STR'
      if (num !== undefined) return 'NUM'
      return KEYWORDS.has(word) ? word : 'ID'
    })
    .replace(/\s+/gu, ' ')
    .trim()
}

const side = (lines: readonly string[]): string =>
  lines.slice(0, SIDE_LINES).map(normalizeLine).join('\n') +
  (lines.length > SIDE_LINES ? `\n+${lines.length - SIDE_LINES} more` : '')

/** The normalised removed lines, then the normalised added lines. */
export const hunkSignature = (hunk: Hunk): string =>
  `${side(hunk.removed)}\n=>\n${side(hunk.added)}`

/** Groups hunks by signature, most hunks first; ties keep first-seen order. */
export function groupHunks(hunks: readonly Hunk[]): SignatureGroup[] {
  const groups = new Map<string, { hunks: number; files: Set<string>; example: Hunk }>()
  for (const hunk of hunks) {
    const signature = hunkSignature(hunk)
    const group = groups.get(signature)
    if (group === undefined) {
      groups.set(signature, { hunks: 1, files: new Set([hunk.path]), example: hunk })
    } else {
      group.hunks += 1
      group.files.add(hunk.path)
    }
  }
  return [...groups]
    .map(([signature, group]) => ({
      signature,
      hunks: group.hunks,
      files: group.files.size,
      example: group.example,
    }))
    .sort((a, b) => b.hunks - a.hunks)
}

/** The share of `total` that the first `count` groups cover, as a whole percent. */
export function coverage(groups: readonly SignatureGroup[], count: number, total: number): number {
  if (total === 0) return 0
  const covered = groups.slice(0, count).reduce((sum, group) => sum + group.hunks, 0)
  return Math.round((covered * 100) / total)
}
