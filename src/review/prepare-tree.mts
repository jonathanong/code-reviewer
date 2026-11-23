import { ReviewError } from './finding.mts'
import type { PrepareIo } from './prepare-io.mts'

/** The checkout must be the pull request head, or the files read from it are not the change's. */
export async function checkTreeHead(io: PrepareIo, tree: string, headSha: string): Promise<void> {
  const treeHead = await io.treeHead(tree)
  if (treeHead !== headSha) {
    throw new ReviewError(
      `--tree ${tree} is at ${treeHead}, not the pull request head ${headSha}; check out the head and run prepare again.`,
    )
  }
}
