import type { PrepareIo } from './prepare-io.mts'
import { writePush, type PushFile } from './push-file.mts'
import type { Write } from './write-diff.mts'

/**
 * Classifies the push since the last trusted review in the `--tree` checkout and writes `push.json`
 * and the merge resolutions. Undefined when there is no earlier review, the head did not move, or
 * there is no checkout to ask.
 */
export async function preparePush(
  io: PrepareIo,
  out: string,
  write: Write,
  args: { tree?: string; reviewedSha: string | null; headSha: string; baseSha: string },
): Promise<PushFile | undefined> {
  const { tree, reviewedSha, headSha, baseSha } = args
  if (tree === undefined || reviewedSha === null || reviewedSha === headSha) return undefined
  return writePush(out, await io.push(tree, { reviewedSha, headSha, baseSha }), write)
}
