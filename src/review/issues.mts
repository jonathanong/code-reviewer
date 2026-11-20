import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'

export const ISSUES_FILE = 'issues.json'

/** An issue the description refers to without closing it. Its text is untrusted. */
export type IssueText = {
  /** `owner/repo#N` */
  ref: string
  state: 'open' | 'closed'
  title: string
  body: string
}

export function clearIssues(out: string): void {
  rmSync(join(out, ISSUES_FILE), { force: true })
}

export function readIssues(out: string): IssueText[] | undefined {
  const path = join(out, ISSUES_FILE)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as IssueText[]) : undefined
}
