import type { PriorFinding } from './context.mts'

const BODY_FINDING_RE =
  /<details><summary>\[(blocking|high|medium|low)\] ([^\n]+?)<\/summary>\n\n<sub>([a-z-]+)<\/sub>/gu
/** The location suffix must look like a path, so a title such as `Foo (bar)` is kept whole. */
const LOCATION_RE = /^(.+) \(([^\s()]*[./][^\s()]*?)(?::(?:\d+-)?(\d+))?\)$/u

/**
 * Parses the findings a final review posted in its body because they had no commentable diff
 * line (see `renderBodyFinding`). They have no thread, so they are carried as unresolved with
 * a null thread id.
 */
export function parseBodyFindings(body: string): PriorFinding[] {
  return [...body.matchAll(BODY_FINDING_RE)].map((match) => {
    const summary = match[2] as string
    const located = LOCATION_RE.exec(summary)
    return {
      threadId: null,
      severity: match[1] as string,
      pillar: match[3] as string,
      title: located?.[1] ?? summary,
      path: located?.[2] ?? null,
      line: located?.[3] === undefined ? null : Number(located[3]),
      outdated: false,
    }
  })
}
