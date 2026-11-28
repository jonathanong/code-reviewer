const SEVERITY = '(blocking|high|medium|low)'
// The head posted today is `[severity · pillar]`; comments posted earlier put the pillar in a
// `<sub>` line after the title, and they stay on GitHub, so both forms are read.
const TAG = `${SEVERITY}(?: · ([a-z-]+))?`
const OLD_PILLAR = '(?:\\n\\n<sub>([a-z-]+)</sub>)?'

export interface FindingHead {
  severity: string
  pillar: string
  title: string
}

function head(
  severity: string,
  tagged: string | undefined,
  title: string,
  old: string | undefined,
) {
  const pillar = tagged ?? old
  return pillar === undefined ? undefined : ({ severity, pillar, title } satisfies FindingHead)
}

/** The head of a posted inline comment, in the current or the earlier form. */
export function parseInlineHead(text: string): FindingHead | undefined {
  const found = new RegExp(`^\\*\\*\\[${TAG}\\]\\*\\* ([^\\n]+)${OLD_PILLAR}`, 'u').exec(text)
  return found === null
    ? undefined
    : head(found[1] as string, found[2], found[3] as string, found[4])
}

const DETAILS_TAG_RE = /<(\/?)details\b[^>]*>/gu

/** A fenced code block, up to the closing fence or the end of the text. */
const FENCE_RE = /^ {0,3}((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^ {0,3}\1\2*[ \t]*$|$(?![\s\S]))/gmu

/** What follows a body finding's summary, up to the `</details>` that closes it; its own collapsed sections nest inside, and tags in a code example do not count. */
function blockText(body: string, from: number): string {
  let depth = 1
  const rest = body.slice(from)
  const visible = rest.replace(FENCE_RE, (fenced) => fenced.replace(/[^\n]/g, ' '))
  for (const tag of visible.matchAll(DETAILS_TAG_RE)) {
    depth += tag[1] === '/' ? -1 : 1
    if (depth === 0) return body.slice(from, from + tag.index).trim()
  }
  return rest.trim()
}

/** The summary heads of findings a review body carries, in the current or the earlier form, each with the text under its summary. */
export function parseBodyBlocks(body: string): Array<FindingHead & { text: string }> {
  const re = new RegExp(`<details><summary>\\[${TAG}\\] ([^\\n]+?)</summary>${OLD_PILLAR}`, 'gu')
  return [...body.matchAll(re)].flatMap((found) => {
    const parsed = head(found[1] as string, found[2], found[3] as string, found[4])
    return parsed === undefined
      ? []
      : [{ ...parsed, text: blockText(body, found.index + found[0].length) }]
  })
}
