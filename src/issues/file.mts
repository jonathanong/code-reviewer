import type { OutcomeRow } from '../outcomes/types.mts'
import type { TrackerIo } from '../tracker/types.mts'
import { DEFAULT_MAX_ISSUES_PER_DAY, type IssuesConfig, type IssueTarget } from './config-parse.mts'
import { issueProposals, markerOf, type IssueProposal } from './proposals.mts'
import { appendFiled, readFiled, type FiledRow } from './record.mts'

/** The window `maxPerDay` counts over, and within which a recorded issue is not searched for again. */
export const DAY_MS = 24 * 60 * 60 * 1000

/** What filing needs from outside: `gh` for one repository, and a temporary file for a body. */
export type IssuesIo = {
  /** Runs `gh` with the credentials for `repo`; rejects on a failure or a timeout. */
  gh(repo: string, args: string[]): Promise<string>
  /** Writes `body` to a temporary file for the duration of `use`, then removes it. */
  withBodyFile<T>(body: string, use: (path: string) => Promise<T>): Promise<T>
}

export type Filed = { key: string; repo: string; url: string | null }
export type Skipped = { key: string; reason: string }
export type IssuesResult = { filed: Filed[]; skipped: Skipped[]; dryRun: boolean }

type Input = {
  config: IssuesConfig | undefined
  rows: readonly OutcomeRow[]
  dryRun: boolean
}

const reason = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** An open issue in `repo` whose body carries the proposal's marker, if any. */
async function findOpen(io: IssuesIo, repo: string, key: string): Promise<string | undefined> {
  const out = await io.gh(repo, [
    'issue',
    'list',
    '--repo',
    repo,
    '--search',
    `"${key}" in:body`,
    '--state',
    'open',
    '--json',
    'number,url,body',
  ])
  const found: unknown = JSON.parse(out)
  if (!Array.isArray(found)) throw new Error('gh issue list did not print a list')
  const marker = markerOf(key)
  const match = found.find(
    (item) =>
      typeof item?.body === 'string' && item.body.includes(marker) && typeof item.url === 'string',
  )
  return match?.url
}

async function create(io: IssuesIo, target: IssueTarget, proposal: IssueProposal) {
  const url = await io.withBodyFile(proposal.body, async (path) => {
    const out = await io.gh(target.repo, [
      'issue',
      'create',
      '--repo',
      target.repo,
      '--title',
      proposal.title,
      '--body-file',
      path,
      ...target.labels.flatMap((label) => ['--label', label]),
    ])
    return out.trim().split('\n').at(-1) as string
  })
  if (!/^https?:\/\//u.test(url)) throw new Error('gh issue create printed no issue URL')
  return url
}

/**
 * Files one issue for each proposal that has a configured target, has no open issue carrying its
 * marker, and fits under `maxPerDay` for the last 24 hours. A failure on one proposal is a skip;
 * the rest go on. With `dryRun` everything but the create runs.
 */
export async function fileIssues(
  input: Input,
  tracker: TrackerIo,
  io: IssuesIo,
): Promise<{ result: IssuesResult; messages: string[] }> {
  const result: IssuesResult = { filed: [], skipped: [], dryRun: input.dryRun }
  const messages: string[] = []
  const skip = (key: string, why: string) => {
    result.skipped.push({ key, reason: why })
    messages.push(`${key}: skipped, ${why}`)
  }
  const now = tracker.now()
  const recent: FiledRow[] = readFiled(tracker).filter(
    (row) => now.getTime() - Date.parse(row.filedAt) < DAY_MS,
  )
  const config = input.config ?? { maxPerDay: DEFAULT_MAX_ISSUES_PER_DAY, targets: [] }
  for (const proposal of issueProposals(input.rows)) {
    const { key } = proposal
    const target = config.targets.find((candidate) => candidate.name === proposal.target)
    if (target === undefined) {
      skip(key, `no target "${proposal.target}" is configured`)
      continue
    }
    const known = recent.find((row) => row.key === key && row.repo === target.repo)
    if (known !== undefined) {
      skip(key, `already filed in the last 24 hours: ${known.url}`)
      continue
    }
    try {
      const open = await findOpen(io, target.repo, key)
      if (open !== undefined) {
        skip(key, `an open issue exists: ${open}`)
        continue
      }
      if (recent.length + result.filed.length >= config.maxPerDay) {
        skip(key, `the limit of ${config.maxPerDay} issues per day is reached`)
        continue
      }
      if (input.dryRun) {
        result.filed.push({ key, repo: target.repo, url: null })
        messages.push(`${key}: would file in ${target.repo}: ${proposal.title}`)
        continue
      }
      const url = await create(io, target, proposal)
      appendFiled(tracker, { key, repo: target.repo, url, filedAt: tracker.now().toISOString() })
      result.filed.push({ key, repo: target.repo, url })
      messages.push(`${key}: filed ${url}`)
    } catch (error) {
      skip(key, `failed: ${reason(error)}`)
    }
  }
  return { result, messages }
}
