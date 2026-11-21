import type { RunTextCommand } from '../gh-cli/index.mts'

/** What GitHub records about one commit of a pull request, as the REST API reports it. */
export type PullCommit = {
  sha: string
  /** The GitHub account the commit's author email resolves to; null when it resolves to none. */
  author: string | null
  /** The GitHub account of the committer; `web-flow` for a commit GitHub itself made and signed. */
  committer: string | null
  /** GitHub verified the commit's signature. */
  verified: boolean
}

export type PullCommits = { commits: PullCommit[]; complete: boolean }

const PAGE_SIZE = 100
/** More commits than this many pages hold are not read: the caller treats them as unknown. */
export const MAX_COMMIT_PAGES = 2

const FIELDS =
  '.[] | {sha, author: .author.login, committer: .committer.login, verified: (.commit.verification.verified == true)} | @json'

/**
 * The pull request's commits, oldest first, in at most `MAX_COMMIT_PAGES` pages of 100. `complete`
 * is false when the last page was full, so there may be more. Rejects when GitHub fails.
 */
export async function fetchPullCommits(
  run: RunTextCommand,
  repo: string,
  pr: number,
): Promise<PullCommits> {
  const commits: PullCommit[] = []
  for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
    const out = await run([
      'api',
      `repos/${repo}/pulls/${pr}/commits?per_page=${PAGE_SIZE}&page=${page}`,
      '-q',
      FIELDS,
    ])
    const lines = out.split('\n').filter((line) => line.trim().length > 0)
    commits.push(...lines.map((line) => JSON.parse(line) as PullCommit))
    if (lines.length < PAGE_SIZE) return { commits, complete: true }
  }
  return { commits, complete: false }
}
