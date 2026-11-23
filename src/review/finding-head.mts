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

/** The summary heads of findings a review body carries, in the current or the earlier form. */
export function parseBodyHeads(body: string): FindingHead[] {
  const re = new RegExp(`<details><summary>\\[${TAG}\\] ([^\\n]+?)</summary>${OLD_PILLAR}`, 'gu')
  return [...body.matchAll(re)].flatMap((found) => {
    const parsed = head(found[1] as string, found[2], found[3] as string, found[4])
    return parsed === undefined ? [] : [parsed]
  })
}
