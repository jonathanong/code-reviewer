import { accountName, authorReview, type AuthorRule } from './author-rules.mts'
import type { PullCommit, PullCommits } from './pull-commits.mts'

/** The committer GitHub records for a commit it made and signed itself (web editor, API, bots). */
const WEB_FLOW = 'web-flow'

/**
 * A commit counts as the author's only when GitHub attributes it to that account AND verified it,
 * and the committer is that account or GitHub itself. The author is whatever email the pusher put
 * in the commit, so it alone proves nothing; a signed commit proves who committed, not who authored.
 * Together they leave a pusher no way to pass as the author. A merge made with the "Update branch"
 * button is authored by whoever clicked, so it is someone else's.
 */
export function isByAuthor(commit: PullCommit, login: string): boolean {
  const { author, committer } = commit
  if (author === null || committer === null || !commit.verified) return false
  const name = accountName(login)
  return accountName(author) === name && (accountName(committer) === name || committer === WEB_FLOW)
}

/**
 * Why the author rule must not hold for this pull request, or undefined when every commit is the
 * author's. Anything unknown (a failed lookup, too many commits, a head the list does not end at)
 * suspends the rule: the cost of a wrong answer is a missed review.
 */
async function authorRuleSuspension(
  lookup: () => Promise<PullCommits>,
  login: string,
  headSha: string,
): Promise<string | undefined> {
  let listed: PullCommits
  try {
    listed = await lookup()
  } catch {
    return `Could not read the commits of this ${login} pull request: normal review.`
  }
  const { commits, complete } = listed
  if (!complete) {
    return `More commits than can be checked on this ${login} pull request: normal review.`
  }
  if (commits.at(-1)?.sha !== headSha) {
    return `The commits of this ${login} pull request do not end at its head: normal review.`
  }
  if (commits.some((commit) => !isByAuthor(commit, login))) {
    return `Commits by others on a ${login} pull request: normal review.`
  }
  return undefined
}

/**
 * The author fields of the plan input. When an author rule applies, the pull request's commits are
 * read (the only time they are) and `authorSuspended` says why the rule must not hold.
 */
export async function planAuthor(
  io: { pullCommits(): Promise<PullCommits> },
  author: { login: string; __typename: string } | null,
  authors: readonly AuthorRule[],
  headSha: string,
): Promise<{ authorLogin: string | null; authorIsBot: boolean; authorSuspended?: string }> {
  const authorLogin = author?.login ?? null
  const authorIsBot = author?.__typename === 'Bot'
  if (authorLogin === null || authorReview(authorLogin, authorIsBot, authors) === undefined) {
    return { authorLogin, authorIsBot }
  }
  const authorSuspended = await authorRuleSuspension(() => io.pullCommits(), authorLogin, headSha)
  return { authorLogin, authorIsBot, ...(authorSuspended === undefined ? {} : { authorSuspended }) }
}
