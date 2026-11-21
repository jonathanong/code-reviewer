/** What the pull request's commit messages say they fix or revert. */
export type LinkHow = 'revert' | 'fixes' | 'mentioned'

export type References = {
  /** Commit ids as written (7 to 40 hex digits), in first-seen order. */
  shas: string[]
  /** Pull request or issue numbers named next to the word regression. */
  numbers: number[]
  /** Subjects of `Revert "<subject>"` commits that name no sha. */
  subjects: string[]
  /** How each sha in `shas` was linked, by the first message that named it. */
  how: Record<string, LinkHow>
}

const REVERT_SHA = /This reverts commit ([0-9a-f]{7,40})\b/giu
const REVERT_SUBJECT = /^Revert "(.+)"$/mu
const FIXES_SHA = /\b(?:fix(?:es|ed)?|closes?|resolves?)\s*:?\s+(?:commit\s+)?([0-9a-f]{7,40})\b/giu
const SHA_TOKEN = /\b[0-9a-f]{7,40}\b/giu
const OWN_PR = /\s*\(#\d+\)\s*$/u
const NUMBER = /#(\d+)\b/gu

/** A short hex word like `defaced` is a word; an id has a digit, or is a full 40 characters. */
const isSha = (token: string): boolean => token.length === 40 || /\d/u.test(token)

const add = <T,>(list: T[], value: T): void => {
  if (!list.includes(value)) list.push(value)
}

const addSha = (found: References, sha: string, how: LinkHow): void => {
  add(found.shas, sha)
  found.how[sha] ??= how
}

/** Reads the messages (one string each) for reverts, fixes of a commit, and regression mentions. */
export function parseReferences(messages: readonly string[]): References {
  const found: References = { shas: [], numbers: [], subjects: [], how: {} }
  for (const message of messages) {
    const subjectLine = message.split('\n')[0]
    const reverted = [...message.matchAll(REVERT_SHA)].map((m) => m[1] as string)
    for (const sha of reverted) addSha(found, sha.toLowerCase(), 'revert')
    const subject = REVERT_SUBJECT.exec(message)?.[1]
    if (subject !== undefined && reverted.length === 0) add(found.subjects, subject)
    for (const match of message.matchAll(FIXES_SHA)) {
      if (isSha(match[1] as string)) addSha(found, (match[1] as string).toLowerCase(), 'fixes')
    }
    for (const line of message.split('\n').filter((l) => /regress/iu.test(l))) {
      for (const token of line.match(SHA_TOKEN) ?? []) {
        if (isSha(token)) addSha(found, token.toLowerCase(), 'mentioned')
      }
      // A trailing `(#N)` on the subject is the commit's own pull request, not a reference.
      const own = line === subjectLine ? line.replace(OWN_PR, '') : line
      for (const match of own.matchAll(NUMBER)) add(found.numbers, Number(match[1]))
    }
  }
  return found
}
