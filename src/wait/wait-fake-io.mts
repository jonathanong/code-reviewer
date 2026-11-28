import { vi } from 'vitest'

import { line } from '../cli/command-replies-line.mts'
import { DEFAULT_LABELS } from '../review/index.mts'
import { APP, HEAD, fakeDeps, marker } from '../run/fake-deps.mts'
import type { HarnessCall, HarnessEvent, HarnessResult } from './harness.mts'
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

export const result = (
  events: HarnessEvent[],
  extra: Partial<HarnessResult> = {},
): HarnessResult => ({
  events,
  gap: false,
  cursor: `c${events.length}`,
  ...extra,
})

export type Setup = {
  labels?: string[]
  reviews?: string[]
  /** What each harness call returns, or throws, in order. */
  calls: Array<HarnessResult | Error>
  open?: boolean
  /** The author of each root comment id. */
  authors?: Record<number, string>
  stateDir: string
}

/** Fake dependencies and a fake `WaitRun`; `calls` is what hook-harness answers, one entry per wait. */
export function setup(options: Setup) {
  const fake = fakeDeps({
    stateDir: options.stateDir,
    labels: options.labels ?? [],
    reviews: options.reviews ?? [],
  })
  let time = 0
  const queue = [...options.calls]
  const harness = vi.fn(async (_call: HarnessCall) => {
    time += 10_000
    const next = queue.shift()
    if (next === undefined) throw new Error('hook-harness was called more often than expected')
    if (next instanceof Error) throw next
    return next
  })
  const replies = vi.fn(async () => line({ exitCode: 11 }))
  const sleep = vi.fn(async (ms: number) => void (time += ms))
  const commentAuthor = vi.fn(async (_repo: string, id: number) => options.authors?.[id] ?? APP)
  const run: WaitRun = {
    harness,
    now: () => time,
    sleep,
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
  return { ...fake, run, harness, replies, sleep, commentAuthor, waitOptions }
}
