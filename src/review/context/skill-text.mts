/** The SKILL.md body without its frontmatter (LF or CRLF). */
export function stripFrontmatter(text: string): string {
  const open = /^---\r?\n/u.exec(text)
  if (open === null) return text
  const close = /(?:^|\r?\n)---[ \t]*(?:\r?\n|$)/u.exec(text.slice(open[0].length))
  return close === null ? text : text.slice(open[0].length + close.index + close[0].length)
}

const FENCE = /^\s*(`{3,}|~{3,})([\s\S]*)$/u
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s/u

/**
 * Feeds lines in order; returns whether the line is a code fence line or inside a code block. A
 * block closes only on a fence of the same character, at least as long as the opener, with
 * nothing after it.
 */
function fenceTracker(): (line: string) => boolean {
  let open: { char: string; length: number } | null = null
  return (line) => {
    const match = FENCE.exec(line)
    const marker = match?.[1] as string
    if (open === null) {
      if (match === null || (marker.startsWith('`') && match[2]!.includes('`'))) return false
      open = { char: marker[0]!, length: marker.length }
      return true
    }
    if (marker?.startsWith(open.char) && marker.length >= open.length && match![2]!.trim() === '') {
      open = null
    }
    return true
  }
}

/**
 * The share of a body's non-blank lines that belong to a list item (the item line and its
 * indented continuations). Headings and fenced code are not counted. An empty body is 0.
 */
export function listShare(body: string): number {
  const inFence = fenceTracker()
  let inItem = false
  let list = 0
  let total = 0
  for (const line of body.split('\n')) {
    if (inFence(line) || line.trim() === '' || /^#{1,6}\s/u.test(line)) continue
    total += 1
    if (ITEM.test(line)) inItem = true
    else if (!(inItem && /^\s/u.test(line))) inItem = false
    if (inItem) list += 1
  }
  return total === 0 ? 0 : list / total
}

/** A `## ` section, or the text before the first one; `text` is its lines verbatim. */
export type SkillSection = { heading: string; text: string }

/** Removes blank lines at both ends; other lines keep their whitespace. */
function trimBlankLines(lines: string[]): string[] {
  let start = 0
  let end = lines.length
  while (start < end && lines[start]!.trim() === '') start += 1
  while (end > start && lines[end - 1]!.trim() === '') end -= 1
  return lines.slice(start, end)
}

/** Splits a body on `## ` headings outside code fences; surrounding blank lines are dropped. */
export function splitSections(body: string): SkillSection[] {
  const sections: { heading: string; lines: string[] }[] = [
    { heading: '(introduction)', lines: [] },
  ]
  const inFence = fenceTracker()
  for (const line of body.split('\n')) {
    if (!inFence(line) && line.startsWith('## ')) {
      sections.push({ heading: line.slice(3).trim(), lines: [] })
    }
    sections.at(-1)!.lines.push(line)
  }
  return sections
    .map(({ heading, lines }) => ({ heading, text: trimBlankLines(lines).join('\n') }))
    .filter((section) => section.text !== '')
}
