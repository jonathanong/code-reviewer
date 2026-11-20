import { join } from 'node:path'

import {
  DEPENDENCIES_FILE,
  mergeDependencies,
  stackDependencies,
  type Dependency,
} from './dependency.mts'
import { dependencyRefs, refKey, refName, type Ref } from './links-refs.mts'
import type { PrepareIo } from './prepare-io.mts'
import type { StackFile } from './stack-file.mts'
import type { Write } from './write-diff.mts'

/** Named references looked up per review; one batched call whatever the count. */
const MAX_REFS = 10

export type LinksArgs = {
  repo: string
  pr: number
  body: string
  /** Commit messages, or their headlines when there is no checkout. */
  commits: readonly string[]
}

/**
 * The pull requests and issues this change says it needs first ("depends on #12", "after owner/repo#3"),
 * named in the description or a commit message, with their current state from one lookup. A state
 * that cannot be read is `unknown`; the review goes on.
 */
export async function prepareDependencies(
  io: PrepareIo,
  args: LinksArgs,
): Promise<{ dependencies: Dependency[]; problems: string[] }> {
  const self: Ref = { repo: args.repo, number: args.pr }
  const fromBody = dependencyRefs(args.body, self)
  const seen = new Set(fromBody.map(refKey))
  const fromCommits = dependencyRefs(args.commits.join('\n'), self).filter(
    (ref) => !seen.has(refKey(ref)),
  )
  const refs = [...fromBody, ...fromCommits].slice(0, MAX_REFS)
  if (refs.length === 0) return { dependencies: [], problems: [] }
  const { found, problems } = await io.linked(refs)
  const dependencies = refs.map((ref): Dependency => {
    const linked = found.get(refKey(ref))
    if (linked?.restricted === true) {
      problems.push(`${refKey(ref)} is in a private repository, so its state was not read.`)
    }
    return {
      on: refName(ref, args.repo),
      kind: linked?.kind ?? 'other',
      state: linked === undefined || linked.restricted ? 'unknown' : linked.state,
      why: seen.has(refKey(ref)) ? 'Named in the description.' : 'Named in a commit message.',
    }
  })
  return { dependencies, problems }
}

const reason = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] as string

/**
 * Finds what this pull request depends on and writes `dependencies.json` when there is any: what
 * the description and commit messages name, plus the stack parents. Never throws.
 */
export async function prepareLinks(
  io: PrepareIo,
  out: string,
  write: Write,
  args: {
    tree?: string
    baseSha: string
    headSha: string
    body: string
    headlines: readonly string[]
    stack?: StackFile
  },
): Promise<{ written: string[]; problems: string[] }> {
  const problems: string[] = []
  let commits = args.headlines
  if (args.tree !== undefined) {
    try {
      commits = await io.commitMessages(args.tree, args.baseSha, args.headSha)
    } catch (error) {
      problems.push(
        `Commit messages could not be read, so only their headlines were: ${reason(error)}`,
      )
    }
  }
  const found = await prepareDependencies(io, {
    repo: io.self.repo,
    pr: io.self.number,
    body: args.body,
    commits,
  })
  const dependencies = mergeDependencies(
    args.stack === undefined ? [] : stackDependencies(args.stack),
    found.dependencies,
  )
  const written = dependencies.length === 0 ? [] : [DEPENDENCIES_FILE]
  if (written.length > 0)
    write(join(out, DEPENDENCIES_FILE), `${JSON.stringify(dependencies, null, 2)}\n`)
  return { written, problems: [...problems, ...found.problems] }
}
