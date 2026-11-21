/** The SKILL.md body without its frontmatter. */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith('---\n')) return text
  const end = text.indexOf('\n---', 4)
  if (end === -1) return text
  const after = text.indexOf('\n', end + 1)
  return after === -1 ? '' : text.slice(after + 1)
}

const FENCE = /^\s*(```|~~~)/u
const ITEM = /^\s*(?:[-*+]|\d+\.)\s/u

/**
 * The share of a body's non-blank lines that belong to a list item (the item line and its
 * indented continuations). Headings and fenced code are not counted. An empty body is 0.
 */
export function listShare(body: string): number {
  let fenced = false
  let inItem = false
  let list = 0
  let total = 0
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced || line.trim() === '' || /^#{1,6}\s/u.test(line)) continue
    total += 1
    if (ITEM.test(line)) inItem = true
    else if (!(inItem && /^\s/u.test(line))) inItem = false
    if (inItem) list += 1
  }
  return total === 0 ? 0 : list / total
}

/** A `## ` section, or the text before the first one; `text` is its lines verbatim. */
export type SkillSection = { heading: string; text: string }

/** Splits a body on `## ` headings outside code fences; surrounding blank lines are dropped. */
export function splitSections(body: string): SkillSection[] {
  const sections: { heading: string; lines: string[] }[] = [
    { heading: '(introduction)', lines: [] },
  ]
  let fenced = false
  for (const line of body.split('\n')) {
    if (FENCE.test(line)) fenced = !fenced
    if (!fenced && line.startsWith('## ')) {
      sections.push({ heading: line.slice(3).trim(), lines: [] })
    }
    sections.at(-1)!.lines.push(line)
  }
  return sections
    .map(({ heading, lines }) => ({ heading, text: lines.join('\n').trim() }))
    .filter((section) => section.text !== '')
}
