import { normalizeSpace } from '../answers.mts'

/** Skill text with the spaces of each line collapsed and its line breaks kept. */
export const normalizeLines = (text: string): string =>
  text.split('\n').map(normalizeSpace).join('\n')

const MARKER = /^(?:[-*+]|\d+[.)])\s+$/u
const OPENER = /^(?:[-*+]\s|\d+[.)]\s|#|\||>)/u
const SENTENCE_END = /[.!?:]$/u

/**
 * Whether a line begins a block, so a quote may start there. A wrapped line continues one; the
 * line after a heading begins one, since a heading is a block of one line.
 */
function beginsBlock(lines: readonly string[], index: number): boolean {
  const before = lines[index - 1]
  return (
    before === undefined ||
    before === '' ||
    SENTENCE_END.test(before) ||
    before.startsWith('#') ||
    OPENER.test(lines[index] as string)
  )
}

/**
 * Whether the quote is a whole unit of the skill text (lines as from `normalizeLines`): it starts
 * where a block, a list item (after its marker) or a sentence starts, and ends where a sentence or
 * a block ends. A tail of a sentence, such as "lock a parent row" out of "Never lock a parent row",
 * is not a unit, even when the sentence is wrapped so that the tail starts a line.
 */
export function quoteHolds(text: string, quote: string): boolean {
  const lines = text.split('\n')
  const flat = lines.join(' ')
  const wanted = normalizeSpace(quote)
  const starts = lines.map(
    (_, index) => lines.slice(0, index).join(' ').length + (index > 0 ? 1 : 0),
  )
  const lineOf = (offset: number) => starts.findLastIndex((start) => start <= offset)
  for (let at = flat.indexOf(wanted); at !== -1; at = flat.indexOf(wanted, at + 1)) {
    const first = lineOf(at)
    const last = lineOf(at + wanted.length - 1)
    const lead = flat.slice(starts[first] as number, at)
    const startsUnit =
      (lead === '' && beginsBlock(lines, first)) ||
      (beginsBlock(lines, first) && MARKER.test(lead)) ||
      /[.!?:] $/u.test(lead)
    const rest = flat.slice(
      at + wanted.length,
      (starts[last] as number) + (lines[last] as string).length,
    )
    const endsUnit =
      rest === ''
        ? last === lines.length - 1 || beginsBlock(lines, last + 1)
        : SENTENCE_END.test(wanted) && rest.startsWith(' ')
    if (startsUnit && endsUnit) return true
  }
  return false
}
