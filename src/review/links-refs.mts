/** A pull request or issue, in this repository or another. */
export type Ref = { repo: string; number: number }

export const refKey = (ref: Ref) => `${ref.repo}#${ref.number}`

/** `#N` for this repository, `owner/repo#N` for another. */
export const refName = (ref: Ref, selfRepo: string) =>
  ref.repo === selfRepo ? `#${ref.number}` : refKey(ref)

const URL_REF = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:issues|pull)\/(\d+)\b/gu
const CROSS_REF = /(?<![\w/.-])([\w.-]+\/[\w.-]+)#(\d+)\b/gu
const LOCAL_REF = /(?<![\w/&#.-])#(\d+)\b/gu
/** A sentence that makes the reference a precondition rather than a mention. */
const DEPENDS =
  /\b(?:depends?\s+on|dependent\s+on|blocked\s+by|waiting\s+(?:on|for)|requires?|needs|after|stacked\s+on|based\s+on|builds?\s+on|merge\s+after|land\s+after)\b/iu

const withoutCode = (text: string) =>
  text.replace(/```[\s\S]*?```/gu, ' ').replace(/`[^`\n]*`/gu, ' ')

function refsOf(text: string, selfRepo: string): Ref[] {
  const hits: { index: number; ref: Ref }[] = []
  for (const match of text.matchAll(URL_REF)) {
    hits.push({ index: match.index, ref: { repo: match[1] as string, number: Number(match[2]) } })
  }
  const bare = text.replace(URL_REF, (url) => ' '.repeat(url.length))
  for (const match of bare.matchAll(CROSS_REF)) {
    hits.push({ index: match.index, ref: { repo: match[1] as string, number: Number(match[2]) } })
  }
  const local = bare.replace(CROSS_REF, (cross) => ' '.repeat(cross.length))
  for (const match of local.matchAll(LOCAL_REF)) {
    hits.push({ index: match.index, ref: { repo: selfRepo, number: Number(match[1]) } })
  }
  return hits.sort((left, right) => left.index - right.index).map(({ ref }) => ref)
}

function unique(refs: readonly Ref[], skip: (ref: Ref) => boolean): Ref[] {
  const seen = new Set<string>()
  const kept: Ref[] = []
  for (const ref of refs) {
    if (skip(ref) || seen.has(refKey(ref))) continue
    seen.add(refKey(ref))
    kept.push(ref)
  }
  return kept
}

/** Every pull request or issue the text names, in order, once, without the pull request itself. */
export function extractRefs(text: string, self: Ref): Ref[] {
  return unique(refsOf(withoutCode(text), self.repo), (ref) => refKey(ref) === refKey(self))
}

/** The references on a line that says this change needs them: "depends on", "after", and so on. */
export function dependencyRefs(text: string, self: Ref): Ref[] {
  const lines = withoutCode(text)
    .split(/\r?\n/u)
    .filter((line) => DEPENDS.test(line))
  return unique(
    lines.flatMap((line) => refsOf(line, self.repo)),
    (ref) => refKey(ref) === refKey(self),
  )
}
