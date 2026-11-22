import type { FollowUpContext } from './context.mts'
import { writeEarlier, type EarlierFile } from './earlier-file.mts'
import type { PrepareIo } from './prepare-io.mts'
import { preparePush } from './push-prepare.mts'
import type { PushFile } from './push-file.mts'
import type { Write } from './write-diff.mts'

/**
 * Classifies the push since the last review and writes `push.json`. A pull request with no posted
 * review but a whole, unposted review on this machine (`earlier`, looked up for the head) is measured against that one,
 * and when git proves the push light, `earlier.json` carries the review forward. Anything else,
 * including a conversation too long to trust that no review was posted, writes no `earlier.json`.
 */
export async function prepareEarlier(
  io: PrepareIo,
  out: string,
  write: Write,
  args: {
    tree?: string
    context: FollowUpContext
    headSha: string
    /** This machine's unposted review of an earlier head than the given one, if it has one. */
    earlier?: ((headSha: string) => EarlierFile | undefined) | undefined
  },
): Promise<{ push: PushFile | undefined; earlier: EarlierFile | undefined }> {
  const { tree, context, headSha } = args
  const local =
    context.reviewedSha === null && !context.truncated ? args.earlier?.(headSha) : undefined
  const push = await preparePush(io, out, write, {
    ...(tree === undefined ? {} : { tree }),
    reviewedSha: context.reviewedSha ?? local?.sha ?? null,
    headSha,
    baseSha: context.baseSha,
    lightOnly: local !== undefined,
  })
  const adopted = push === undefined ? undefined : local
  if (adopted !== undefined) writeEarlier(out, adopted, write)
  return { push, earlier: adopted }
}
