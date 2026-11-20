import type { RunTextCommand } from '../gh-cli/index.mts'
import { refKey, type Ref } from './links-refs.mts'

/** What one lookup learned about a pull request or issue. */
export type Linked = {
  kind: 'issue' | 'pull'
  state: 'open' | 'merged' | 'closed'
  /** In a private repository while the repository under review is public: not read. */
  restricted: boolean
  /** An issue's own words, untrusted; absent for a pull request. */
  title?: string
  body?: string
}

export type LinkedLookup = {
  found: Map<string, Linked>
  problems: string[]
}

type Node = {
  __typename?: string
  state?: string
  merged?: boolean
  title?: string
  body?: string
} | null

type Alias = { isPrivate?: boolean; issueOrPullRequest?: Node } | null

const NAME = /^[\w.-]+$/u
const split = (repo: string) => repo.split('/') as [string, string]
const valid = (ref: Ref) => split(ref.repo).every((part) => NAME.test(part))

function buildQuery(self: string, refs: readonly Ref[]): string {
  const [owner, name] = split(self)
  const body = refs.map((ref, index) => {
    const [refOwner, refName] = split(ref.repo)
    return `r${index}: repository(owner: "${refOwner}", name: "${refName}") { isPrivate issueOrPullRequest(number: ${ref.number}) { __typename ... on Issue { state title body } ... on PullRequest { state merged } } }`
  })
  return `query { self: repository(owner: "${owner}", name: "${name}") { isPrivate } ${body.join(' ')} }`
}

/** A failed `gh api graphql` still prints what it could read; a missing reference fails the call. */
function partial(error: unknown): string | undefined {
  const stdout = (error as { stdout?: unknown } | null)?.stdout
  return typeof stdout === 'string' && stdout.trim().startsWith('{') ? stdout : undefined
}

const reason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] as string

/**
 * The state of each reference in one GraphQL call. A reference that cannot be read (not found, no
 * access, a failed call) is absent from `found` and counted in `problems`; nothing throws.
 */
export async function lookupLinked(
  run: RunTextCommand,
  selfRepo: string,
  refs: readonly Ref[],
): Promise<LinkedLookup> {
  const asked = refs.filter(valid)
  const found = new Map<string, Linked>()
  if (asked.length === 0) return { found, problems: [] }
  const problems: string[] = []
  let out: string | undefined
  try {
    out = await run(['api', 'graphql', '-f', `query=${buildQuery(selfRepo, asked)}`])
  } catch (error) {
    out = partial(error)
    if (out === undefined) {
      return {
        found,
        problems: [`Linked pull requests and issues could not be read: ${reason(error)}`],
      }
    }
  }
  let data: Record<string, Alias>
  try {
    data = (JSON.parse(out) as { data?: Record<string, Alias> }).data ?? {}
  } catch (error) {
    return {
      found,
      problems: [`Linked pull requests and issues could not be read: ${reason(error)}`],
    }
  }
  const selfPrivate = data.self?.isPrivate
  asked.forEach((ref, index) => {
    const alias = data[`r${index}`]
    const node = alias?.issueOrPullRequest
    if (node === null || node === undefined || node.state === undefined) return
    const restricted = selfPrivate === false && alias?.isPrivate === true
    const state =
      node.merged === true ? 'merged' : node.state.toLowerCase() === 'open' ? 'open' : 'closed'
    found.set(refKey(ref), {
      kind: node.__typename === 'PullRequest' ? 'pull' : 'issue',
      state,
      restricted,
      ...(node.__typename === 'Issue' ? { title: node.title ?? '', body: node.body ?? '' } : {}),
    })
  })
  const missing = asked.filter((ref) => !found.has(refKey(ref)))
  if (missing.length > 0) {
    problems.push(
      `Could not read ${missing.map(refKey).join(', ')}: not found, or not visible to this account.`,
    )
  }
  return { found, problems }
}
