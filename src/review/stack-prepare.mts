import { join } from 'node:path'

import { numberDiff } from './numbered-diff.mts'
import type { PrepareIo } from './prepare-io.mts'
import { detectStack, type StackMember } from './stack.mts'
import { writeDiffDir, type Write } from './write-diff.mts'
import type { StackFile, StackFileMember } from './stack-file.mts'

/** Models read the patches through the index, so only an extreme diff is left out. */
const MAX_MEMBER_DIFF_BYTES = 20_000_000

/** The member whose head branch is `member`'s base: the walk only adds members that have one. */
const parentOf = (members: readonly StackMember[], member: StackMember) =>
  members.find((other) => other.headRef === member.baseRef) as StackMember

const firstLine = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).split('\n')[0] as string

/**
 * Detects the stack of the pull request and writes `stack.json` plus `stack/<number>.diff` for each
 * later member. A failure to list open pull requests is returned as a problem and leaves the pull
 * request flat, so it never fails the review.
 */
export async function prepareStack(
  io: PrepareIo,
  out: string,
  write: Write,
  tree?: string,
): Promise<{ stack?: StackFile; problem?: string }> {
  let stack
  try {
    const input = await io.stackInput()
    stack = detectStack(input.pr, input.pulls, input.defaultBranch)
  } catch (error) {
    return {
      problem: `Open pull requests could not be listed, so the stack is unknown: ${firstLine(error)}`,
    }
  }
  if (stack === undefined) return {}
  const later = stack.members.slice(stack.index + 1)
  const patches = await Promise.all(
    later.map((member) =>
      io.memberDiff(member, parentOf(stack.members, member).headSha, tree).then(
        (patch) => ({ patch }),
        (error: unknown) => ({ error: firstLine(error) }),
      ),
    ),
  )
  const members: StackFileMember[] = stack.members.slice(0, stack.index + 1)
  later.forEach((member, at) => {
    const read = patches[at] as { patch?: string; error?: string }
    if (read.patch === undefined) {
      members.push({ ...member, diffSkipped: `the diff could not be read: ${read.error}` })
      return
    }
    const bytes = Buffer.byteLength(read.patch)
    if (bytes > MAX_MEMBER_DIFF_BYTES) {
      members.push({ ...member, diffSkipped: `the diff is ${bytes} bytes, over the stack limit` })
      return
    }
    const dir = join('stack', String(member.number))
    writeDiffDir(join(out, dir), numberDiff(read.patch), write)
    members.push({ ...member, diff: join(dir, 'INDEX.md') })
  })
  const file: StackFile = { ...stack, members }
  write(join(out, 'stack.json'), `${JSON.stringify(file, null, 2)}\n`)
  return { stack: file }
}
