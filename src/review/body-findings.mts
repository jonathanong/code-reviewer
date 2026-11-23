import type { PriorFinding } from './context.mts'
import { parseBodyHeads } from './finding-head.mts'

/** The location suffix must look like a path, so a title such as `Foo (bar)` is kept whole. */
const LOCATION_RE = /^(.+) \(([^\s()]*[./][^\s()]*?)(?::(?:\d+-)?(\d+))?\)$/u

/**
 * Parses the findings a review posted in its body because they had no commentable diff
 * line (see `renderBodyFinding`). They have no thread, so they are carried as unresolved with
 * a null thread id.
 */
export function parseBodyFindings(body: string): PriorFinding[] {
  return parseBodyHeads(body).map((head) => {
    const summary = head.title
    const located = LOCATION_RE.exec(summary)
    return {
      threadId: null,
      severity: head.severity,
      pillar: head.pillar,
      title: located?.[1] ?? summary,
      path: located?.[2] ?? null,
      line: located?.[3] === undefined ? null : Number(located[3]),
      outdated: false,
    }
  })
}
