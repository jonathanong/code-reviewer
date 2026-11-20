import type { RunTextCommand } from '../gh-cli/index.mts'
import type { StackMember } from './stack.mts'

/** Open pull requests read per repository; the walk never needs more. */
const MAX_OPEN_PULLS = 500

const PULL_FIELDS =
  '.[] | {number, title, headRef: .head.ref, baseRef: .base.ref, headSha: .head.sha, headRepo: .head.repo.full_name} | @json'

type RawPull = Partial<Record<keyof StackMember | 'headRepo', unknown>>

function member(raw: RawPull, repo: string): StackMember[] {
  const { number, title, headRef, baseRef, headSha, headRepo } = raw
  const valid =
    typeof number === 'number' &&
    typeof title === 'string' &&
    typeof headRef === 'string' &&
    typeof baseRef === 'string' &&
    typeof headSha === 'string'
  // A pull request from a fork cannot be the base of another pull request in this repository.
  const sameRepo = typeof headRepo === 'string' && headRepo.toLowerCase() === repo.toLowerCase()
  return valid && sameRepo ? [{ number, title, headRef, baseRef, headSha }] : []
}

/** The repository's open pull requests whose head branch lives in the repository itself. */
export async function fetchOpenPulls(run: RunTextCommand, repo: string): Promise<StackMember[]> {
  const out = await run([
    'api',
    '--paginate',
    `repos/${repo}/pulls?state=open&per_page=100`,
    '-q',
    PULL_FIELDS,
  ])
  return out
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .flatMap((line) => member(JSON.parse(line) as RawPull, repo))
    .slice(0, MAX_OPEN_PULLS)
}

export async function fetchDefaultBranch(run: RunTextCommand, repo: string): Promise<string> {
  const branch = (await run(['api', `repos/${repo}`, '-q', '.default_branch'])).trim()
  if (branch === '') throw new Error(`The default branch of ${repo} is unknown.`)
  return branch
}
