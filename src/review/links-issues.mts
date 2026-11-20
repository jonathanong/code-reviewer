import { join } from 'node:path'

import type { PrConversation } from './context-query.mts'
import { ISSUES_FILE, type IssueText } from './issues.mts'
import { refKey, extractRefs, type Ref } from './links-refs.mts'
import type { PrepareIo } from './prepare-io.mts'
import type { Write } from './write-diff.mts'

/** Referenced issues fetched per review, and the characters kept of each body. */
const MAX_ISSUES = 8
const BODY_CHARS = 1500
const TITLE_CHARS = 200

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

/**
 * The issues the description refers to without closing them (`See #4`, `owner/repo#9`, an issue
 * URL), with their title and body, so the congruence check can hold the change to what each asks.
 * They are written to `issues.json` when there are any. Closing issues are in `context.md`
 * already. A private repository named from a public one, an unreadable issue, and a pull request
 * are left out; a lookup that fails records a problem and the review goes on.
 */
export async function prepareIssues(
  io: PrepareIo,
  out: string,
  write: Write,
  pull: Pick<PrConversation, 'body' | 'closingIssuesReferences'>,
): Promise<{ issues: IssueText[]; written: string[]; problems: string[] }> {
  const repo = io.self.repo
  const closing = new Set(
    pull.closingIssuesReferences.nodes.map((issue) => refKey({ repo, number: issue.number })),
  )
  const refs: Ref[] = extractRefs(pull.body, io.self)
    .filter((ref) => !closing.has(refKey(ref)))
    .slice(0, MAX_ISSUES)
  if (refs.length === 0) return { issues: [], written: [], problems: [] }
  const { found, problems } = await io.linked(refs)
  const issues = refs.flatMap((ref): IssueText[] => {
    const linked = found.get(refKey(ref))
    if (linked === undefined || linked.kind !== 'issue') return []
    if (linked.restricted) {
      problems.push(`${refKey(ref)} is in a private repository, so its text was not read.`)
      return []
    }
    return [
      {
        ref: refKey(ref),
        state: linked.state === 'open' ? 'open' : 'closed',
        title: clip(linked.title ?? '', TITLE_CHARS),
        body: clip(linked.body ?? '', BODY_CHARS),
      },
    ]
  })
  if (issues.length === 0) return { issues, written: [], problems }
  write(join(out, ISSUES_FILE), `${JSON.stringify(issues, null, 2)}\n`)
  return { issues, written: [ISSUES_FILE], problems }
}
