import type { RunTextCommand } from '../gh-cli/index.mts'
import { asNumber, asRecord, asString, type Json } from '../tracker/json.mts'
import { readReactions } from './reactions.mts'
import type { CommentData, PullData, ReviewData, ThreadData } from './types.mts'

/** Pages read per connection and pull request; more is reported as truncated. */
export const MAX_PAGES = 5

const REACTIONS = 'reactionGroups { content reactors { totalCount } }'

const REVIEWS = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    state headRefOid
    reviews(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { databaseId state body url author { login } ${REACTIONS} }
    }
  } }
}`

const THREADS = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) {
    reviewThreads(first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { isResolved isOutdated comments(first: 30) { nodes {
        databaseId body url path line originalLine originalStartLine
        originalCommit { oid } author { login } ${REACTIONS}
        pullRequestReview { databaseId }
      } } }
    }
  } }
}`

const list = (value: unknown): Json[] => (Array.isArray(value) ? value.map(asRecord) : [])

type Pages = { pull: Json; nodes: Json[]; truncated: boolean }

/** One paginated read of a pull request connection, at most `MAX_PAGES` pages. */
async function pages(
  run: RunTextCommand,
  query: string,
  field: string,
  target: { owner: string; name: string; pr: number },
): Promise<Pages> {
  const nodes: Json[] = []
  let pull: Json = {}
  let after: string | undefined
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${target.owner}`]
    args.push('-f', `name=${target.name}`, '-F', `number=${target.pr}`)
    if (after !== undefined) args.push('-f', `after=${after}`)
    const parsed = asRecord(JSON.parse(await run(args)))
    pull = asRecord(asRecord(asRecord(parsed.data).repository).pullRequest)
    const connection = asRecord(pull[field])
    nodes.push(...list(connection.nodes))
    const info = asRecord(connection.pageInfo)
    after = asString(info.endCursor) ?? undefined
    if (info.hasNextPage !== true || after === undefined) return { pull, nodes, truncated: false }
  }
  return { pull, nodes, truncated: true }
}

function comment(node: Json): CommentData {
  const end = asNumber(node.originalLine) ?? asNumber(node.line)
  return {
    id: asNumber(node.databaseId) ?? 0,
    author: asString(asRecord(node.author).login),
    body: asString(node.body) ?? '',
    url: asString(node.url),
    path: asString(node.path),
    startLine: asNumber(node.originalStartLine) ?? end,
    endLine: end,
    oid: asString(asRecord(node.originalCommit).oid),
    reviewId: asNumber(asRecord(node.pullRequestReview).databaseId),
    reactions: readReactions(node.reactionGroups),
  }
}

const thread = (node: Json): ThreadData => ({
  resolved: node.isResolved === true,
  outdated: node.isOutdated === true,
  comments: list(asRecord(node.comments).nodes).map(comment),
})

const review = (node: Json): ReviewData => ({
  id: asNumber(node.databaseId) ?? 0,
  state: asString(node.state) ?? '',
  body: asString(node.body) ?? '',
  url: asString(node.url),
  author: asString(asRecord(node.author).login),
  reactions: readReactions(node.reactionGroups),
})

/** A pull request's state, reviews and review threads: two paginated read-only call sets. */
export async function fetchPull(run: RunTextCommand, repo: string, pr: number): Promise<PullData> {
  const [owner = '', name = ''] = repo.split('/')
  const target = { owner, name, pr }
  const reviews = await pages(run, REVIEWS, 'reviews', target)
  const threads = await pages(run, THREADS, 'reviewThreads', target)
  return {
    state: asString(reviews.pull.state) ?? 'OPEN',
    head: asString(reviews.pull.headRefOid) ?? '',
    reviews: reviews.nodes.map(review),
    threads: threads.nodes.map(thread),
    truncated: reviews.truncated || threads.truncated,
  }
}
