import { vi } from 'vitest'

import { line } from '../cli/command-replies-line.mts'
import { DEFAULT_LABELS } from '../review/index.mts'
import { APP, HEAD, fakeDeps, marker } from '../run/fake-deps.mts'
import type { HarnessBatch, HarnessCall, HarnessEvent } from './harness.mts'
import type { WaitOptions, WaitRun } from './wait.mts'

export { APP, HEAD, marker }

export const REQUESTED = DEFAULT_LABELS.requested
export const repo = 'acme/widgets'

export const labelEvent = (pr = 4, extra: Partial<HarnessEvent> = {}): HarnessEvent => ({
  repo,
  prs: [pr],
  event: 'pull_request',
  action: 'labeled',
  label: REQUESTED,
  sender: { login: 'dev' },
  headSha: HEAD,
  ...extra,
})

export const commentEvent = (
  pr = 4,
  root: number | null = 100,
  sender = 'dev',
  extra: Partial<HarnessEvent> = {},
): HarnessEvent => ({
  repo,
  prs: [pr],
  event: 'pull_request_review_comment',
  action: 'created',
  sender: { login: sender },
  payload: { comment: { id: 101, in_reply_to_id: root, user: { login: sender } } },
  ...extra,
})

/** One poll that found `events`. */
export const result = (
  events: HarnessEvent[],
  extra: { gap?: boolean; cursor?: string } = {},
): HarnessBatch => ({
  owner: 'acme',
  events,
  gap: false,
  cursor: `c${events.length}`,
  ...extra,
})

/** One poll that failed in a way hook-harness retries. */
export const failedPoll = (message = 'relay unavailable', owner = 'acme'): HarnessBatch => ({
  owner,
  error: new Error(message),
})

export type Setup = {
  labels?: string[]
  reviews?: string[]
  /** What hook-harness yields, or throws, in order; the poll ends after the last, as at the timeout. */
  calls: Array<HarnessBatch | Error>
  open?: boolean
  /** The author of each root comment id. */
  authors?: Record<number, string>
  stateDir: string
}

/** Fake dependencies and a fake `WaitRun`; `calls` is what one hook-harness poll yields. */
export function setup(options: Setup) {
  const fake = fakeDeps({
    stateDir: options.stateDir,
    labels: options.labels ?? [],
    reviews: options.reviews ?? [],
  })
  const queue = [...options.calls]
  const harness = vi.fn(async function* (_call: HarnessCall) {
    for (const next of queue) {
      if (next instanceof Error) throw next
      yield next
    }
  })
  const replies = vi.fn(async () => line({ exitCode: 11 }))
  const commentAuthor = vi.fn(async (_repo: string, id: number) => options.authors?.[id] ?? APP)
  const run: WaitRun = {
    harness,
    isOpen: vi.fn(async () => options.open ?? true),
    commentAuthor,
    replies,
  }
  const waitOptions: WaitOptions = {
    owners: ['acme'],
    labels: [REQUESTED],
    ignoreSenders: ['coderabbitai[bot]'],
    timeoutSeconds: 100,
    cursorName: 'test',
    own: new Set([APP]),
  }
  return { ...fake, run, harness, replies, commentAuthor, waitOptions }
}
