import { isAppConfigFailure, splitRepo } from '../gh-cli/index.mts'
import { assertOwner, reviewSettings } from '../review/index.mts'
import { defaultExec } from '../review/benchmark/exec.mts'
import { resolveTrustedAuthors } from '../review/trust.mts'
import type { RunExit } from '../run/output.mts'
import { Precondition } from '../run/preflight.mts'
import { createHarness } from '../wait/harness.mts'
import { wait, waitFailure, type WaitRun } from '../wait/wait.mts'
import { repliesLine } from './command-replies.mts'
import type { ReviewDeps } from './deps.mts'

export type WaitValues = {
  owner?: string | undefined
  timeout?: string | undefined
  'cursor-name'?: string | undefined
  'ignore-sender'?: string[] | undefined
  label?: string[] | undefined
}

/** Agents reply to CodeRabbit's threads under the same login authors use; its events never need the reviewer. */
export const DEFAULT_IGNORE_SENDERS = ['coderabbitai[bot]']
const DEFAULT_TIMEOUT_SECONDS = 2 * 60 * 60
const DEFAULT_CURSOR_NAME = 'review-loop'

/** `2h`, `30m`, `90s` or a bare number of seconds. */
export function parseTimeout(text: string | undefined): number {
  if (text === undefined) return DEFAULT_TIMEOUT_SECONDS
  const match = /^(\d+)([smh])?$/u.exec(text)
  const seconds = match === null ? 0 : Number(match[1]) * { s: 1, m: 60, h: 3600 }[match[2] ?? 's']!
  if (seconds <= 0) throw new Precondition('--timeout must be a duration such as 2h, 30m or 90s.')
  return seconds
}

/** The real GitHub reads, the reply run in this process, and hook-harness through `npx`. */
export function createWaitRun(deps: ReviewDeps): WaitRun {
  const run = (repo: string) => {
    const { owner, name } = splitRepo(repo)
    return deps.runner(owner, name)
  }
  return {
    harness: createHarness(defaultExec),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    isOpen: async ({ repo, pr }) =>
      (await run(repo)(['api', `repos/${repo}/pulls/${pr}`, '--jq', '.state'])).trim() === 'open',
    commentAuthor: async (repo, id) => {
      const login = (
        await run(repo)(['api', `repos/${repo}/pulls/comments/${id}`, '--jq', '.user.login'])
      ).trim()
      return login === '' ? undefined : login
    },
    replies: ({ repo, pr }) => repliesLine({ repo: [repo], pr: String(pr), post: 'auto' }, deps),
  }
}

/**
 * `code-reviewer wait`: hook-harness waits for request labels and review-comment replies, filtered
 * in code (docs/wait.md). Prints one JSON line when something needs the session and exits 0, or
 * 11 at the timeout, 12 for a configuration problem and 13 for a hook-harness failure.
 */
export async function runWaitCommand(
  values: WaitValues,
  deps: ReviewDeps,
  run: WaitRun = createWaitRun(deps),
): Promise<RunExit> {
  let result
  try {
    const owners = (values.owner ?? '').split(',').filter((owner) => owner !== '')
    if (owners.length === 0)
      throw new Precondition('wait needs --owner (a login, or a comma list).')
    for (const owner of owners) {
      try {
        assertOwner(owner)
      } catch (error) {
        throw new Precondition((error as Error).message, { cause: error })
      }
      try {
        if (deps.authMode() === 'app') await deps.checkInstallation(owner)
      } catch (error) {
        if (isAppConfigFailure(error)) {
          throw new Precondition((error as Error).message, { cause: error })
        }
        throw error
      }
    }
    const own = new Set<string>()
    for (const owner of owners) {
      const identity = async () => (await deps.authIdentity()).login
      for (const login of await resolveTrustedAuthors(deps.runner(owner), identity)) own.add(login)
    }
    if (own.size === 0) throw new Precondition('the reviewer identity is unknown.')
    const requested = new Set(values.label ?? [])
    for (const owner of owners)
      requested.add(reviewSettings(deps.configs(), owner).labels.requested)
    const ignoreSenders = values['ignore-sender'] ?? DEFAULT_IGNORE_SENDERS
    result = await wait(
      {
        owners,
        labels: [...requested],
        ignoreSenders: [...own, ...ignoreSenders],
        timeoutSeconds: parseTimeout(values.timeout),
        cursorName: values['cursor-name'] ?? DEFAULT_CURSOR_NAME,
        own,
      },
      deps,
      run,
    )
  } catch (error) {
    const failure = waitFailure(error)
    process.stdout.write(
      `${JSON.stringify({ outcome: 'error', exitCode: failure.exitCode, error: failure.error })}\n`,
    )
    return failure.exitCode
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  return result.exitCode
}
