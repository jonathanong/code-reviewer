import type { RunTextCommand } from '../gh-cli/index.mts'
import { walkOlder, type Page } from './context-older.mts'
import { assertPullTarget, type PullTarget } from './target.mts'

/** `__typename` is the GraphQL actor type (`User`, `Bot`, ...). */
export type Author = { login: string; __typename?: string } | null

export type PrReview = {
  id: string
  url?: string
  /** Hidden by a moderator or the author; the verifier does not read it. */
  isMinimized?: boolean
  author: Author
  state: string
  body: string
  submittedAt: string | null
  commit: { oid: string } | null
}

export type ThreadComment = {
  url?: string
  isMinimized?: boolean
  author: Author
  body: string
  createdAt: string
  pullRequestReview: { id: string } | null
}

export type ReviewThread = {
  id: string
  isResolved: boolean
  isOutdated: boolean
  path: string
  line: number | null
  /** `totalCount` is the thread's real size; `nodes` holds at most `THREAD_COMMENTS` of them. */
  comments: { totalCount?: number; nodes: ThreadComment[] }
}

export const THREAD_COMMENTS = 20

export { MAX_OLDER_REVIEW_PAGES, MAX_OLDER_THREAD_PAGES } from './context-older.mts'

export type PageInfo = { hasPreviousPage: boolean; startCursor?: string | null }

/** Reviews per page, newest first. */
const REVIEWS_PAGE = 60
/** Review threads per page, newest first. */
const THREADS_PAGE = 100
export type ClosingIssue = { number: number; title: string; body: string }

/** The pull request author; `__typename` is the GraphQL actor type (`User`, `Bot`, ...). */
export type PrAuthor = { login: string; __typename: string }

export type PrConversation = {
  title: string
  /** Null for a deleted account. */
  author: PrAuthor | null
  body: string
  closingIssuesReferences: { nodes: ClosingIssue[] }
  headRefOid: string
  baseRefOid: string
  /** The base branch's name, which may no longer exist. */
  baseRefName: string
  additions: number
  deletions: number
  /** After the walk back, `pageInfo.hasPreviousPage` is whether older reviews remain unread. */
  reviews: { nodes: PrReview[]; pageInfo?: PageInfo; totalCount?: number }
  /**
   * The newest page whole, plus the open threads (unresolved, first comment not hidden) of older
   * pages. `pageInfo.hasPreviousPage` is whether the walk hit its page cap with pages left, and
   * `unread` how many older threads it did not look at.
   */
  reviewThreads: {
    nodes: ReviewThread[]
    pageInfo?: PageInfo
    totalCount?: number
    unread?: number
  }
  /** Older reviews or threads existed, so resolved or hidden history of them was not read. */
  olderSkipped?: boolean
  comments: {
    nodes: { author: Author; body: string; createdAt: string; isMinimized?: boolean }[]
  }
  commits: { nodes: { commit: { oid: string; messageHeadline: string } }[] }
}

const THREAD_FIELDS = `
          id isResolved isOutdated path line
          comments(first: ${THREAD_COMMENTS}) {
            totalCount
            nodes {
              url body createdAt isMinimized
              author { login __typename }
              pullRequestReview { id }
            }
          }`
const REVIEW_FIELDS = `
          id url state body submittedAt isMinimized
          author { login __typename }
          commit { oid }`

const QUERY = `query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      title body headRefOid baseRefOid baseRefName additions deletions
      author { login __typename }
      closingIssuesReferences(first: 20) { nodes { number title body } }
      reviews(last: ${REVIEWS_PAGE}) {
        totalCount
        pageInfo { hasPreviousPage startCursor }
        nodes {${REVIEW_FIELDS}
        }
      }
      reviewThreads(last: ${THREADS_PAGE}) {
        totalCount
        pageInfo { hasPreviousPage startCursor }
        nodes {${THREAD_FIELDS}
        }
      }
      comments(last: 30) { nodes { body createdAt isMinimized author { login __typename } } }
      commits(last: 100) { nodes { commit { oid messageHeadline } } }
    }
  }
}`

function olderQuery(connection: 'reviews' | 'reviewThreads'): string {
  const page = connection === 'reviews' ? REVIEWS_PAGE : THREADS_PAGE
  const fields = connection === 'reviews' ? REVIEW_FIELDS : THREAD_FIELDS
  return `query($owner: String!, $name: String!, $pr: Int!, $before: String!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      ${connection}(last: ${page}, before: $before) {
        pageInfo { hasPreviousPage startCursor }
        nodes {${fields}
        }
      }
    }
  }
}`
}

/**
 * Reads the review conversation of a pull request: the newest reviews and threads in one GraphQL
 * call, then older pages (see `walkOlder` for what is read and where it stops).
 */
export async function fetchConversation(
  target: PullTarget,
  run: RunTextCommand,
  options: { trusted: ReadonlySet<string> },
): Promise<PrConversation> {
  assertPullTarget(target)
  const [owner, name] = target.repo.split('/') as [string, string]
  const vars = ['-f', `owner=${owner}`, '-f', `name=${name}`, '-F', `pr=${target.pr}`]
  const out = await run(['api', 'graphql', '-f', `query=${QUERY}`, ...vars])
  const pull = (JSON.parse(out) as { data: { repository: { pullRequest: PrConversation | null } } })
    .data.repository.pullRequest
  if (pull === null) throw new Error(`Pull request ${target.repo}#${target.pr} not found.`)

  async function older<T>(
    connection: 'reviews' | 'reviewThreads',
    before: string,
  ): Promise<Page<T>> {
    const body = await run([
      'api',
      'graphql',
      '-f',
      `query=${olderQuery(connection)}`,
      ...vars,
      '-f',
      `before=${before}`,
    ])
    const parsed = JSON.parse(body) as {
      data: { repository: { pullRequest: Record<string, Page<T>> | null } }
    }
    const page = parsed.data.repository.pullRequest?.[connection]
    if (page === undefined) throw new Error(`Pull request ${target.repo}#${target.pr} not found.`)
    return page
  }

  await walkOlder(pull, older, options.trusted)
  return pull
}
