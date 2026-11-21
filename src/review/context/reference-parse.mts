/** What the pull request's commit messages say they fix or revert. */
export type References = {
  /** Commit ids as written (7 to 40 hex digits), in first-seen order. */
  shas: string[]
  /** Pull request or issue numbers named next to the word regression. */
  numbers: number[]
  /** Subjects of `Revert "<subject>"` commits that name no sha. */
  subjects: string[]
}

const REVERT_SHA = /This reverts commit ([0-9a-f]{7,40})\b/giu
const REVERT_SUBJECT = /^Revert "(.+)"$/mu
const FIXES_SHA = /\b(?:fix(?:es|ed)?|closes?|resolves?)\s*:?\s+(?:commit\s+)?([0-9a-f]{7,40})\b/giu
const SHA_TOKEN = /\b[0-9a-f]{7,40}\b/giu
const NUMBER = /#(\d+)\b/gu

/** A short hex word like `defaced` is a word; an id has a digit, or is a full 40 characters. */
const isSha = (token: string): boolean => token.length === 40 || /\d/u.test(token)

const add = <T,>(list: T[], value: T): void => {
  if (!list.includes(value)) list.push(value)
}

/** Reads the messages (one string each) for reverts, fixes of a commit, and regression mentions. */
export function parseReferences(messages: readonly string[]): References {
  const found: References = { shas: [], numbers: [], subjects: [] }
  for (const message of messages) {
    const reverted = [...message.matchAll(REVERT_SHA)].map((m) => m[1] as string)
    for (const sha of reverted) add(found.shas, sha.toLowerCase())
    const subject = REVERT_SUBJECT.exec(message)?.[1]
    if (subject !== undefined && reverted.length === 0) add(found.subjects, subject)
    for (const match of message.matchAll(FIXES_SHA)) {
      if (isSha(match[1] as string)) add(found.shas, (match[1] as string).toLowerCase())
    }
    for (const line of message.split('\n').filter((l) => /regress/iu.test(l))) {
      for (const token of line.match(SHA_TOKEN) ?? []) {
        if (isSha(token)) add(found.shas, token.toLowerCase())
      }
      for (const match of line.matchAll(NUMBER)) add(found.numbers, Number(match[1]))
    }
  }
  return found
}
