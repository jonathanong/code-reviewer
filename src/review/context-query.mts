import type { RunTextCommand } from '../gh-cli/index.mts'
import { assertPullTarget, type PullTarget } from './target.mts'

export type Author = { login: string } | null

export type PrReview = {
  id: string
  url?: string
  author: Author
  state: string
  body: string
  submittedAt: string | null
  commit: { oid: string } | null
}

export type ThreadComment = {
  url?: string
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

export type PageInfo = { hasPreviousPage: boolean }

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
  reviews: { nodes: PrReview[]; pageInfo?: PageInfo }
  reviewThreads: { nodes: ReviewThread[]; pageInfo?: PageInfo }
  comments: { nodes: { author: Author; body: string; createdAt: string }[] }
  commits: { nodes: { commit: { oid: string; messageHeadline: string } }[] }
}

const QUERY = `query($owner: String!, $name: String!, $pr: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequest(number: $pr) {
      title body headRefOid baseRefOid baseRefName additions deletions
      author { login __typename }
      closingIssuesReferences(first: 20) { nodes { number title body } }
      reviews(last: 60) {
        pageInfo { hasPreviousPage }
        nodes { id url state body submittedAt author { login } commit { oid } }
      }
      reviewThreads(last: 100) {
        pageInfo { hasPreviousPage }
        nodes {
          id isResolved isOutdated path line
          comments(first: ${THREAD_COMMENTS}) {
            totalCount
            nodes { url body createdAt author { login } pullRequestReview { id } }
          }
        }
      }
      comments(last: 30) { nodes { body createdAt author { login } } }
      commits(last: 100) { nodes { commit { oid messageHeadline } } }
    }
  }
}`

/** Reads the review conversation of a pull request in one GraphQL call. */
export async function fetchConversation(
  target: PullTarget,
  run: RunTextCommand,
): Promise<PrConversation> {
  assertPullTarget(target)
  const [owner, name] = target.repo.split('/') as [string, string]
  const out = await run([
    'api',
    'graphql',
    '-f',
    `query=${QUERY}`,
    '-f',
    `owner=${owner}`,
    '-f',
    `name=${name}`,
    '-F',
    `pr=${target.pr}`,
  ])
  const pull = (JSON.parse(out) as { data: { repository: { pullRequest: PrConversation | null } } })
    .data.repository.pullRequest
  if (pull === null) throw new Error(`Pull request ${target.repo}#${target.pr} not found.`)
  return pull
}
