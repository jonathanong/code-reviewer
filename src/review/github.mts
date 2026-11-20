import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { runGh, type RunTextCommand } from '../gh-cli/index.mts'
import {
  parseReviewFilesJson,
  type ReviewFile,
  type SanitizedReview,
} from '../review-payload/index.mts'
import { createGhLabelIo } from './labels.mts'
import { DEFAULT_LABELS } from './settings.mts'
import { assertPullTarget, type PullTarget } from './target.mts'
import { resolveTrustedAuthors, type TrustedAuthors } from './trust.mts'

/** The GitHub reads and writes a review needs, injectable for tests. */
export type ReviewIo = {
  headSha(): Promise<string>
  /** The pull request's unified diff against its base. */
  diff(): Promise<string>
  listFiles(): Promise<ReviewFile[]>
  /** Review bodies with their author logins, oldest first. */
  listReviews(): Promise<{ body: string; author: string | null }[]>
  /** Logins whose `final-review` markers count; see `resolveTrustedAuthors`. */
  trustedAuthors(): Promise<TrustedAuthors>
  hasApprovalLabel(): Promise<boolean>
  postReview(review: SanitizedReview): Promise<string>
  addApprovalLabel(): Promise<void>
  removeApprovalLabel(): Promise<void>
}

function lines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Builds `ReviewIo` on top of the authenticated `gh` CLI. */
export function createGhReviewIo(
  target: PullTarget,
  run: RunTextCommand = runGh,
  trustedAllowlist: readonly string[] = [],
  approvalLabel: () => Promise<string> = async () => DEFAULT_LABELS.approval,
): ReviewIo {
  assertPullTarget(target)
  const { repo, pr } = target
  const pull = `repos/${repo}/pulls/${pr}`
  return {
    async headSha() {
      return (
        await run([
          'pr',
          'view',
          String(pr),
          '-R',
          repo,
          '--json',
          'headRefOid',
          '-q',
          '.headRefOid',
        ])
      ).trim()
    },
    async diff() {
      return run(['pr', 'diff', String(pr), '-R', repo, '--color', 'never'])
    },
    async listFiles() {
      return parseReviewFilesJson(await run(['api', '--paginate', `${pull}/files?per_page=100`]))
    },
    async listReviews() {
      const out = await run([
        'api',
        '--paginate',
        `${pull}/reviews?per_page=100`,
        '-q',
        '.[] | {body, author: .user.login} | @json',
      ])
      return lines(out).map((line) => JSON.parse(line) as { body: string; author: string | null })
    },
    trustedAuthors: () => resolveTrustedAuthors(run, trustedAllowlist),
    async hasApprovalLabel() {
      const out = await run([
        'pr',
        'view',
        String(pr),
        '-R',
        repo,
        '--json',
        'labels',
        '-q',
        '.labels[].name',
      ])
      return lines(out).includes(await approvalLabel())
    },
    async postReview(review) {
      const dir = mkdtempSync(join(tmpdir(), 'review-'))
      try {
        const file = join(dir, 'review.json')
        writeFileSync(file, JSON.stringify(review))
        const out = await run([
          'api',
          '--method',
          'POST',
          `${pull}/reviews`,
          '--input',
          file,
          '-q',
          '.html_url',
        ])
        return out.trim()
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    },
    async addApprovalLabel() {
      // The issues labels endpoint creates a missing label, so no separate setup step is needed.
      await run([
        'api',
        '--method',
        'POST',
        `repos/${repo}/issues/${pr}/labels`,
        '-f',
        `labels[]=${await approvalLabel()}`,
      ])
    },
    async removeApprovalLabel() {
      // One label per request: `gh pr edit --remove-label` splits a name on commas.
      await createGhLabelIo(target, run).remove(await approvalLabel())
    },
  }
}
