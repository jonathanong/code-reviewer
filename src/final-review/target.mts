export type PullTarget = { repo: string; pr: number }

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u

export function assertRepo(repo: string): void {
  if (!REPO_RE.test(repo)) throw new Error('--repo must be owner/name.')
}

export function assertPullTarget(target: PullTarget): void {
  assertRepo(target.repo)
  if (!Number.isInteger(target.pr) || target.pr <= 0)
    throw new Error('--pr must be a positive integer.')
}
