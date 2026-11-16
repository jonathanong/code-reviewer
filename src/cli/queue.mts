import { listQueue, type QueueEntry } from '../final-review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import type { FinalReviewDeps } from './deps.mts'
import { labelsFor } from './review-settings.mts'

/**
 * Lists `repos` with one search per owner (each owner has its own installation token) and per label
 * set (the search names the labels).
 */
async function listRepos(deps: FinalReviewDeps, repos: readonly string[]): Promise<QueueEntry[]> {
  const groups = new Map<
    string,
    { owner: string; labels: ReturnType<typeof labelsFor>; repos: string[] }
  >()
  for (const repo of repos) {
    const { owner } = splitRepo(repo)
    const labels = labelsFor(deps, repo)
    const key = JSON.stringify([owner, labels.requested, labels.processing])
    const group = groups.get(key) ?? { owner, labels, repos: [] }
    groups.set(key, { ...group, repos: [...group.repos, repo] })
  }
  const entries = await Promise.all(
    [...groups.values()].map(({ owner, labels, repos: group }) => {
      const only = group.length === 1 ? splitRepo(group[0] as string).name : undefined
      return listQueue(deps.runner(owner, only), owner, group, labels)
    }),
  )
  return entries.flat()
}

/**
 * The review queue for `--repo` entries, or for every repository of `owner`. An owner search uses
 * the owner's labels, so repositories whose own file changes `requested` or `processing` are
 * searched separately with their labels and left out of the owner-wide results.
 */
export async function listQueueFor(
  deps: FinalReviewDeps,
  owner: string | undefined,
  repos: readonly string[],
): Promise<QueueEntry[]> {
  if (repos.length > 0) return listRepos(deps, repos)
  if (owner === undefined || owner === '') throw new Error('queue needs --owner or --repo.')
  const base = labelsFor(deps, owner)
  const prefix = `${owner.toLowerCase()}/`
  const overridden = [...deps.configs().byRepo.keys()].filter((repo) => {
    const labels = labelsFor(deps, repo)
    return (
      repo.startsWith(prefix) &&
      (labels.requested !== base.requested || labels.processing !== base.processing)
    )
  })
  const [ownerWide, scoped] = await Promise.all([
    listQueue(deps.runner(owner), owner, [], base),
    listRepos(deps, overridden),
  ])
  const seen = new Set<string>()
  return [
    ...ownerWide.filter((entry) => !overridden.includes(entry.repo.toLowerCase())),
    ...scoped,
  ].filter((entry) => {
    const key = `${entry.repo.toLowerCase()}#${entry.pr}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
