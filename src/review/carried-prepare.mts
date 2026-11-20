import { join } from 'node:path'

import { CARRIED_FILE, type CarriedFile } from './carried-file.mts'
import type { PullRef } from './carried-inspect.mts'
import type { PrepareIo } from './prepare-io.mts'
import type { StackFile } from './stack-file.mts'
import type { StackMember } from './stack.mts'
import type { OpenPulls } from './stack-prepare.mts'
import type { Write } from './write-diff.mts'

/** Older open pull requests compared per review; each costs one `git cherry`. */
const MAX_OTHERS = 20

export type CarriedPrepare = {
  tree?: string
  baseSha: string
  headSha: string
  baseRef: string
  stack?: StackFile
  /** The repository's open pull requests, when they could be listed. */
  open?: OpenPulls
}

const ref = ({ number, headSha }: StackMember): PullRef => ({ number, headSha })

/**
 * Asks local git which commits of the pull request already exist in the default branch, a parent in
 * the stack, or an older open pull request, and whether its base branch is gone or merged. Writes
 * `carried.json` only when there is something to say. Without a checkout nothing is claimed.
 */
export async function prepareCarried(
  io: PrepareIo,
  out: string,
  write: Write,
  args: CarriedPrepare,
): Promise<{ file?: CarriedFile; problems: string[] }> {
  if (args.tree === undefined) return { problems: [] }
  const members = args.stack?.members ?? []
  const below = members.slice(0, args.stack?.index ?? 0)
  const inStack = new Set(members.map((member) => member.number))
  const pr = args.open?.pr as number
  const others = (args.open?.pulls ?? [])
    .filter(
      (pull) => pull.number < pr && !inStack.has(pull.number) && pull.headSha !== args.headSha,
    )
    .sort((left, right) => right.number - left.number)
    .slice(0, MAX_OTHERS)
  const inspection = await io.carried(args.tree, {
    baseSha: args.baseSha,
    headSha: args.headSha,
    baseRef: args.baseRef,
    parents: below.map(ref),
    others: others.map(ref),
  })
  const problems = [...inspection.problems]
  let baseMergedIn: number | undefined
  if (inspection.base === 'present' || inspection.base === 'missing') {
    try {
      baseMergedIn = await io.mergedPull(args.baseRef)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      problems.push(
        `Whether the base branch was merged could not be read: ${reason.split('\n')[0]}`,
      )
    }
  }
  const file: CarriedFile = {
    ...inspection,
    problems,
    baseRef: args.baseRef,
    ...(baseMergedIn === undefined ? {} : { baseMergedIn }),
  }
  const worth = file.commits.length > 0 || file.base === 'missing' || baseMergedIn !== undefined
  if (!worth) return { problems }
  write(join(out, CARRIED_FILE), `${JSON.stringify(file, null, 2)}\n`)
  return { file, problems }
}
