import type { RunTextCommand } from '../gh-cli/index.mts'
import type { LabelNames } from './settings.mts'

export type QueueEntry = {
  repo: string
  pr: number
  headSha: string
  state: 'requested' | 'in-progress'
  isDraft: boolean
  updatedAt: string
  url: string
}

const OWNER_RE = /^[A-Za-z0-9_.-]+$/u
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

const QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 100) {
    nodes {
      ... on PullRequest {
        number url isDraft updatedAt headRefOid
        repository { nameWithOwner }
      }
    }
  }
}`

type Node = {
  number?: number
  url?: string
  isDraft?: boolean
  updatedAt?: string
  headRefOid?: string
  repository?: { nameWithOwner?: string }
}

/** The search qualifier for one owner, or for specific repositories. */
export function scopeQualifier(owner: string, repos: readonly string[]): string {
  if (repos.length > 0) {
    for (const repo of repos) if (!REPO_RE.test(repo)) throw new Error(`Invalid repo: ${repo}`)
    return repos.map((repo) => `repo:${repo}`).join(' ')
  }
  assertOwner(owner)
  return `org:${owner}`
}

export function assertOwner(owner: string): void {
  if (!OWNER_RE.test(owner)) throw new Error('--owner must be a GitHub login.')
}

async function search(
  run: RunTextCommand,
  scope: string,
  label: string,
  state: QueueEntry['state'],
): Promise<QueueEntry[]> {
  const q = `${scope} is:pr is:open label:"${label}" sort:updated-asc`
  const out = await run(['api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=${q}`])
  const nodes = (JSON.parse(out) as { data: { search: { nodes: Node[] } } }).data.search.nodes
  return nodes.flatMap((node) =>
    node.number === undefined || node.repository?.nameWithOwner === undefined
      ? []
      : [
          {
            repo: node.repository.nameWithOwner,
            pr: node.number,
            headSha: node.headRefOid ?? '',
            state,
            isDraft: node.isDraft === true,
            updatedAt: node.updatedAt ?? '',
            url: node.url ?? '',
          },
        ],
  )
}

/**
 * The fallback intake when hook-harness is unavailable or reports a gap: open pull requests that
 * request a final review, plus ones left in progress (a restart abandoned them), oldest first.
 * `labels` is one label set, so callers group repositories that share one.
 */
export async function listQueue(
  run: RunTextCommand,
  owner: string,
  repos: readonly string[],
  labels: Pick<LabelNames, 'requested' | 'processing'>,
): Promise<QueueEntry[]> {
  const scope = scopeQualifier(owner, repos)
  const [requested, inProgress] = await Promise.all([
    search(run, scope, labels.requested, 'requested'),
    search(run, scope, labels.processing, 'in-progress'),
  ])
  return [...inProgress, ...requested]
}
