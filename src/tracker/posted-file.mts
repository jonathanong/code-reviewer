import { dirname, join, resolve } from 'node:path'

import type { Finding } from '../review/finding.mts'
import type { Placement } from '../review/placements.mts'
import type { Recorded } from './record.mts'

/** One finding of a posted review and where it went; `id` is `F<n>`, its position in `review.json`. */
export type PostedFinding = {
  id: string
  title: string
  path: string | null
  placement: Placement
}

/** `posted.json` in the run directory: which findings of that run reached the pull request, and how. */
export type PostedFile = { version: 1; headSha: string; findings: PostedFinding[] }

export const POSTED_FILE = 'posted.json'

/**
 * Saves per-finding posted status beside `--input`, in the run directory. Never throws: a failure
 * is reported beside the post result, like a tracker failure.
 */
export function savePostedFindings(
  write: (path: string, text: string) => void,
  input: string,
  headSha: string,
  findings: readonly Finding[],
  placements: readonly Placement[],
): Recorded {
  let posted = 0
  const saved: PostedFile = {
    version: 1,
    headSha,
    // `placements` covers the findings that were posted, in order; a pre-existing one is not
    // posted inline, but it keeps its position in `review.json` for the ids that follow it.
    findings: findings.flatMap((finding, position) =>
      finding.preExisting === true
        ? []
        : [
            {
              id: `F${position + 1}`,
              title: finding.title,
              path: finding.path ?? null,
              placement: placements[posted++] as Placement,
            },
          ],
    ),
  }
  try {
    write(join(dirname(resolve(input)), POSTED_FILE), `${JSON.stringify(saved, null, 2)}\n`)
    return {}
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    return { trackerProblem: `the posted findings could not be saved: ${reason}` }
  }
}
