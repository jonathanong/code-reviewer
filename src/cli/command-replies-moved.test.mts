import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkoutHead } from '../run/tree.mts'
import { approveReplies } from './command-replies-approve.mts'
import {
  comment,
  conversation,
  dropRoot,
  makeRoot,
  model,
  run,
  setup,
} from './command-replies-fake-io.mts'

vi.mock('./command-replies-approve.mts', async (original) => ({
  ...(await original<typeof import('./command-replies-approve.mts')>()),
  approveReplies: vi.fn(),
}))
vi.mock('../run/tree.mts', async (original) => ({
  ...(await original<typeof import('../run/tree.mts')>()),
  checkoutHead: vi.fn(),
}))

const NEW_HEAD = 'c'.repeat(40)
const DIFF = 'diff --git a/a.ts b/a.ts\n-const legacy = true\n+const legacy = false\n'

beforeEach(() => {
  makeRoot()
  vi.mocked(checkoutHead).mockResolvedValue({
    path: '/tree',
    kind: 'worktree',
    remove: async () => undefined,
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  dropRoot()
})

function moved(answer?: string) {
  const fake = setup({
    pull: conversation({ head: NEW_HEAD, replies: [comment('dev', 'Fixed in cccccc.')] }),
    newHead: NEW_HEAD,
    ...(answer === undefined ? {} : { answer }),
  })
  const git = (fake.env as unknown as { git: ReturnType<typeof vi.fn> }).git
  git.mockImplementation(async (args: string[]) => (args.includes('diff') ? DIFF : ''))
  return { fake, git }
}

describe('replies at a head that moved since the review', () => {
  it('judges the thread against the diff, replies and resolves it, and posts no verdict', async () => {
    const { fake } = moved()
    const line = await run(fake)
    expect(line).toMatchObject({
      outcome: 'applied',
      headSha: NEW_HEAD,
      verdictBefore: 'Request Changes',
      verdictAfter: 'Request Changes',
      event: null,
      reviewUrl: null,
      replied: ['T1'],
      resolved: ['T1'],
    })
    expect(line.attention).toEqual([
      expect.stringContaining('only a follow-up review gives a verdict'),
    ])
    expect(JSON.stringify(fake.deps.exec.mock.calls[0])).toContain('+const legacy = false')
    expect(fake.io.postReview).not.toHaveBeenCalled()
    expect(approveReplies).not.toHaveBeenCalled()
    expect(fake.io.addApprovalLabel).not.toHaveBeenCalled()
    expect(fake.io.removeApprovalLabel).not.toHaveBeenCalled()
    // The completion label was not there before, and the run does not add it for the new head.
    expect(fake.labels).toEqual([])
  })

  it('gives back the completion label the pull request carried', async () => {
    const { fake } = moved()
    fake.labels.push('final-review:complete')
    await run(fake)
    expect(fake.labels).toEqual(['final-review:complete'])
  })

  it('answers a claimed fix the diff does not show without resolving it', async () => {
    const { fake } = moved(
      model([{ thread: 'T1', outcome: 'open', why: 'The diff does not change that line.' }]),
    )
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'applied', replied: ['T1'], resolved: [], event: null })
    expect(fake.reply.mock.calls[0]?.[1]).toContain('Still open')
    expect(fake.io.postReview).not.toHaveBeenCalled()
  })

  it('does nothing when no thread has a new reply', async () => {
    const fake = setup({ pull: conversation({ head: NEW_HEAD, replies: [] }) })
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop', exitCode: 11 })
    expect(fake.deps.exec).not.toHaveBeenCalled()
    expect(checkoutHead).not.toHaveBeenCalled()
  })

  it('does nothing, and names why, when the changes since the review cannot be read', async () => {
    const { fake, git } = moved()
    git.mockRejectedValue(new Error('bad object'))
    const line = await run(fake)
    expect(line).toMatchObject({ outcome: 'noop', headSha: NEW_HEAD })
    expect(line.reason).toContain('bad object')
    expect(fake.deps.exec).not.toHaveBeenCalled()
    expect(fake.reply).not.toHaveBeenCalled()
  })
})
