import { listQueue, type LabelNames, type QueueEntry } from '../review/index.mts'
import { splitRepo } from '../gh-cli/index.mts'
import type { ReviewDeps } from './deps.mts'
import { labelsFor } from './review-settings.mts'

/**
 * Lists `repos` with one search per owner (each owner has its own installation token) and per label
 * set (the search names the labels).
 */
async function listRepos(deps: ReviewDeps, repos: readonly string[]): Promise<QueueEntry[]> {
  const groups = new Map<string, { owner: string; labels: LabelNames; repos: string[] }>()
  const resolved = await Promise.all(repos.map((repo) => labelsFor(deps, repo)))
  for (const [index, repo] of repos.entries()) {
    const { owner } = splitRepo(repo)
    const labels = resolved[index] as LabelNames
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
 * searched separately with their labels and left out of the owner-wide results. Only repositories
 * with a machine config are checked for overrides; a repository's own file is read when it is
 * named with `--repo`.
 */
export async function listQueueFor(
  deps: ReviewDeps,
  owner: string | undefined,
  repos: readonly string[],
): Promise<QueueEntry[]> {
  if (repos.length > 0) return listRepos(deps, repos)
  if (owner === undefined || owner === '') throw new Error('queue needs --owner or --repo.')
  const base = await labelsFor(deps, owner)
  const prefix = `${owner.toLowerCase()}/`
  const configured = [...deps.configs().byRepo.keys()].filter((repo) => repo.startsWith(prefix))
  const configuredLabels = await Promise.all(configured.map((repo) => labelsFor(deps, repo)))
  const overridden = configured.filter((_repo, index) => {
    const labels = configuredLabels[index] as LabelNames
    return labels.requested !== base.requested || labels.processing !== base.processing
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
