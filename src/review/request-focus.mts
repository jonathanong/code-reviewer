import type { PrConversation } from './context-query.mts'
import { isTrustedAuthor } from './trust.mts'

/**
 * A line that introduces a check list: `Focus`, `Review focus`, `Focus on`, `Please focus on`,
 * `Check`, `Checks`, `Please check` or `Things to check`, in any case, with Markdown heading, quote
 * and bold marks around it and an optional colon. Text after the colon is the first point. Only
 * this exact lead-in counts, so a sentence that merely mentions checking opens nothing.
 */
const LEAD_IN =
  /^(?:please )?(?:review focus|focus on|focus|things to check|checks?)(?: please)?\s*(?::\s*(.*))?$/iu

const ITEM = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(\S.*)$/u

/** A line without its heading and quote marks, bold marks and surrounding space. */
const bare = (line: string): string =>
  line
    .replace(/^[#>\s]+/u, '')
    .replaceAll(/\*\*|__/gu, '')
    .trim()

/** A list item's text without a task-list checkbox. */
const itemText = (text: string): string => text.replace(/^\[[ xX]\]\s+/u, '').trim()

/**
 * The points of the first explicit check list in `text`: the list items under a lead-in line (see
 * `LEAD_IN`), preceded by the text after the lead-in's colon when there is some. Blank lines may
 * sit between the lead-in and its list; the list ends at the first line that is neither blank nor
 * an item. Everything else in the text is not a point. Pure text: the same text always gives the
 * same points.
 */
export function checkList(text: string): string[] {
  const lines = text.split(/\r?\n/u)
  for (const [index, line] of lines.entries()) {
    const lead = LEAD_IN.exec(bare(line))
    if (lead === null) continue
    const points = [lead[1] ?? '']
    for (const next of lines.slice(index + 1)) {
      if (next.trim() === '') continue
      const item = ITEM.exec(next)
      if (item === null) break
      points.push(item[1] as string)
    }
    const found = points.map(itemText).filter((point) => point !== '')
    if (found.length > 0) return found
  }
  return []
}

/** The check list found, and the words it came from, for a message that names them. */
export type RequestFocus = { points: string[]; source: string }

/**
 * The explicit check list of whoever asked for the review, read from the conversation the run
 * already fetches: the requester's newest visible comment on the pull request that holds a check
 * list; failing that, when the requester is also the pull request's author, the description's.
 * Only the requester's own words count, because anyone may comment and the points steer what a
 * model reads. Undefined when there is no list.
 */
export function requestFocus(pull: PrConversation, requester: string): RequestFocus | undefined {
  const asked = new Set([requester])
  const comment = pull.comments.nodes
    .filter((node) => node.isMinimized !== true && isTrustedAuthor(node.author?.login, asked))
    .toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((node) => checkList(node.body))
    .find((points) => points.length > 0)
  if (comment !== undefined) return { points: comment, source: "the requester's comment" }
  if (!isTrustedAuthor(pull.author?.login, asked)) return undefined
  const points = checkList(pull.body)
  return points.length === 0 ? undefined : { points, source: 'the pull request description' }
}
