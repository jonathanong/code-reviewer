import type { PrepareIo } from './prepare-io.mts'
import { writePush, type PushFile } from './push-file.mts'
import type { Write } from './write-diff.mts'

/**
 * Classifies the push since the last trusted review in the `--tree` checkout and writes `push.json`
 * and the merge resolutions. Undefined when there is no earlier review, the head did not move, or
 * there is no checkout to ask. With `lightOnly`, a push that is `substantive` also gives undefined
 * and writes nothing: the earlier review it was measured against is not the pull request's own.
 */
export async function preparePush(
  io: PrepareIo,
  out: string,
  write: Write,
  args: {
    tree?: string
    reviewedSha: string | null
    headSha: string
    baseSha: string
    lightOnly?: boolean
  },
): Promise<PushFile | undefined> {
  const { tree, reviewedSha, headSha, baseSha } = args
  if (tree === undefined || reviewedSha === null || reviewedSha === headSha) return undefined
  const inspection = await io.push(tree, { reviewedSha, headSha, baseSha })
  if (args.lightOnly === true && inspection.kind === 'substantive') return undefined
  return writePush(out, inspection, write)
}
