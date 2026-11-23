import { normalizeSpace } from '../answers.mts'

/** Skill text with the spaces of each line collapsed and its line breaks kept. */
export const normalizeLines = (text: string): string =>
  text.split('\n').map(normalizeSpace).join('\n')

const LIST_MARKER = /^(?:[-*+>]|\d+[.)]|#+)?\s*$/u
const SENTENCE_END = /[.!?:]\s$/u

/**
 * Whether the quote is a whole unit of the skill text: it starts at the text, after a sentence end,
 * or at a line or list item start, and ends at a sentence end or the end of a line. A tail of a
 * sentence, such as "lock a parent row" out of "Never lock a parent row", is not a unit.
 */
export function quoteHolds(lined: string, quote: string): boolean {
  const flat = lined.replaceAll('\n', ' ')
  const wanted = normalizeSpace(quote)
  for (let at = flat.indexOf(wanted); at !== -1; at = flat.indexOf(wanted, at + 1)) {
    const before = lined.slice(0, at)
    const line = before.slice(before.lastIndexOf('\n') + 1)
    const next = lined[at + wanted.length]
    const starts = LIST_MARKER.test(line) || SENTENCE_END.test(before)
    const ends = next === undefined || next === '\n' || (/[.!?:]$/u.test(wanted) && next === ' ')
    if (starts && ends) return true
  }
  return false
}
