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

type Hit = { index: number; ref: Ref }

function hitsOf(text: string, selfRepo: string): Hit[] {
  const hits: Hit[] = []
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
  return hits.sort((left, right) => left.index - right.index)
}

const refsOf = (text: string, selfRepo: string) => hitsOf(text, selfRepo).map(({ ref }) => ref)

/** How far back from a reference its precondition phrase may start, within one sentence. */
const GOVERNS = 80

/** Whether a precondition phrase leads up to the reference at `index`, in the same sentence. */
function governed(line: string, index: number): boolean {
  const sentence = line
    .slice(0, index)
    .split(/[.;!?]\s/u)
    .at(-1) as string
  return DEPENDS.test(sentence.slice(-GOVERNS))
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

/**
 * The references a precondition phrase leads up to: "depends on #1 and #2", "after #3". A phrase
 * elsewhere on the line does not count, so "refs #4; the jobs require handlers" names nothing.
 */
export function dependencyRefs(text: string, self: Ref): Ref[] {
  const lines = withoutCode(text).split(/\r?\n/u)
  return unique(
    lines.flatMap((line) =>
      hitsOf(line, self.repo)
        .filter(({ index }) => governed(line, index))
        .map(({ ref }) => ref),
    ),
    (ref) => refKey(ref) === refKey(self),
  )
}
