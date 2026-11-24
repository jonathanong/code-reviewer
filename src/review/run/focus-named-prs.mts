import type { Exec } from '../benchmark/exec.mts'
import type { FocusPoint } from '../focus.mts'
import { MAX_FOCUS_FACT_FILES, parseNameStatusZ, type StatusEntry } from './focus-facts.mts'

export const MAX_NAMED_PRS = 3
const FETCH_TIMEOUT_MS = 60_000
const GIT_TIMEOUT_MS = 30_000
const SHA_RE = /^[0-9a-f]{40}$/u

/** `#123`, `PR 123`, `PR #123`, `pull request 123` and `pull request #123`, in any case. */
const REFERENCE = /(?<![\w&])#(\d{1,9})(?!\w)|\b(?:PR|pull\s+request)\s+#?(\d{1,9})(?!\w)/giu

export type NamedPrFile = StatusEntry & { shared: boolean }

export type NamedPrFact = {
  number: number
  /** Null when the pull request could not be read from git. */
  head: string | null
  files: { total: number; shared: number; omitted: number; listed: NamedPrFile[] } | null
}

/**
 * The first `MAX_NAMED_PRS` distinct other pull requests that requester points name, in order of
 * appearance. Target points never count, and neither does the pull request under review.
 */
export function namedPullRequests(points: readonly FocusPoint[], current?: number): number[] {
  const found: number[] = []
  for (const { point, origin } of points) {
    if (origin !== 'requester') continue
    for (const match of point.matchAll(REFERENCE)) {
      const number = Number.parseInt((match[1] ?? match[2]) as string, 10)
      if (number > 0 && number !== current && !found.includes(number)) found.push(number)
    }
  }
  return found.slice(0, MAX_NAMED_PRS)
}

export type NamedPrInput = {
  tree: string
  baseSha?: string | undefined
  headSha?: string | undefined
  exec: Exec
  /** Pull request number to a full commit: used in place of the live `refs/pull/<n>/head`. */
  refs?: Readonly<Record<string, string>> | undefined
}

const git = (input: NamedPrInput, args: string[], timeoutMs = GIT_TIMEOUT_MS) =>
  input.exec('git', args, { cwd: input.tree, timeoutMs })

async function resolveHead(input: NamedPrInput, number: number): Promise<string> {
  const pinned = input.refs?.[String(number)]
  if (pinned !== undefined && SHA_RE.test(pinned)) {
    try {
      await git(input, ['cat-file', '-e', `${pinned}^{commit}`])
    } catch {
      await git(input, ['fetch', '--quiet', '--no-tags', 'origin', pinned], FETCH_TIMEOUT_MS)
    }
    return pinned
  }
  const ref = `refs/pull/${number}/head`
  await git(input, ['fetch', '--quiet', '--no-tags', 'origin', ref], FETCH_TIMEOUT_MS)
  return (await git(input, ['rev-parse', '--verify', 'FETCH_HEAD^{commit}'])).trim()
}

async function changed(input: NamedPrInput, from: string, to: string): Promise<StatusEntry[]> {
  return parseNameStatusZ(await git(input, ['diff', '--name-status', '-z', '-M', from, to]))
}

async function factFor(
  input: NamedPrInput,
  base: string,
  number: number,
  here: Set<string>,
): Promise<NamedPrFact> {
  try {
    const head = await resolveHead(input, number)
    const mergeBase = (await git(input, ['merge-base', base, head])).trim()
    const all = (await changed(input, mergeBase, head)).map((entry): NamedPrFile => ({
      ...entry,
      shared: here.has(entry.path),
    }))
    const shared = all.filter((file) => file.shared)
    const listed = [...shared, ...all.filter((file) => !file.shared)]
    return {
      number,
      head: head.slice(0, 12),
      files: {
        total: all.length,
        shared: shared.length,
        omitted: Math.max(0, all.length - MAX_FOCUS_FACT_FILES),
        listed: listed.slice(0, MAX_FOCUS_FACT_FILES),
      },
    }
  } catch {
    return { number, head: null, files: null }
  }
}

/**
 * What each named pull request changes, from local git: its head is fetched from the checkout's
 * origin (or taken from `refs`) and diffed against its merge base with this review's base. A
 * failure leaves that pull request unreadable and never throws. No git command runs when none is
 * named.
 */
export async function buildNamedPrFacts(
  numbers: readonly number[],
  input: NamedPrInput,
): Promise<NamedPrFact[]> {
  if (numbers.length === 0) return []
  const { baseSha, headSha } = input
  if (baseSha === undefined || headSha === undefined) {
    return numbers.map((number) => ({ number, head: null, files: null }))
  }
  let here = new Set<string>()
  try {
    here = new Set((await changed(input, baseSha, headSha)).map((entry) => entry.path))
  } catch {
    // This pull request's own file list is only for marking; the named one is still shown.
  }
  const facts: NamedPrFact[] = []
  for (const number of numbers) facts.push(await factFor(input, baseSha, number, here))
  return facts
}
