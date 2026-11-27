import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_MODEL_PLAN } from '../review/models.mts'
import type { Judgment } from '../review/replies/judge.mts'
import { reassess } from '../review/replies/reassess.mts'
import type { ReplyPlan, StandingFinding } from '../review/replies/select.mts'
import { applyApprovalCheck, type ApprovalCheck } from '../review/run/approval-check.mts'
import { HEAD, fakeDeps } from '../run/fake-deps.mts'
import { checkoutHead } from '../run/tree.mts'
import { prepareCommand } from './command-loop.mts'
import { approveReplies } from './command-replies-approve.mts'

vi.mock('../run/tree.mts', async (original) => ({
  ...(await original<typeof import('../run/tree.mts')>()),
  checkoutHead: vi.fn(),
}))
vi.mock('./command-loop.mts', async (original) => ({
  ...(await original<typeof import('./command-loop.mts')>()),
  prepareCommand: vi.fn(),
}))
vi.mock('../review/run/approval-check.mts', async (original) => ({
  ...(await original<typeof import('../review/run/approval-check.mts')>()),
  applyApprovalCheck: vi.fn(),
}))

const references = fileURLToPath(new URL('../../skills/review/references', import.meta.url))
const pull = { repo: 'acme/widgets', pr: 4 }
const standing: StandingFinding = {
  thread: 'T1',
  severity: 'blocking',
  pillar: 'congruence',
  title: 'Option removed',
  path: 'a.ts',
  line: 3,
}
const plan: ReplyPlan = {
  headSha: HEAD,
  reviewedSha: HEAD,
  reviewId: 'R1',
  author: 'dev',
  effort: 'high',
  posted: 'Request Changes',
  questions: [],
  approvalSkipped: false,
  standing: [standing, { ...standing, thread: 'T2', severity: 'medium', title: 'Naming' }],
  candidates: [],
  unjudged: [],
}
const judgments: Judgment[] = [
  { thread: 'T1', outcome: 'settled', severity: 'blocking', why: 'Declared.' },
  { thread: 'T2', outcome: 'open', severity: 'medium', why: 'No evidence.' },
  { thread: 'T9', outcome: 'settled', severity: 'low', why: 'Unknown thread.' },
]
const result = reassess(plan, judgments, { passed: true })

const check = (overrides: Partial<ApprovalCheck>): ApprovalCheck => ({
  model: 'opus',
  outcome: 'upheld',
  verdictBefore: 'Approve',
  verdictAfter: 'Approve',
  note: 'Looks right.',
  findings: [],
  questions: [],
  usage: null,
  ...overrides,
})

const checked = (overrides: Partial<ApprovalCheck>) => ({
  check: check(overrides),
  findings: [],
  questions: [],
  skipped: [],
})

function setup(options: { ownerConfig?: unknown; remove?: () => Promise<void> } = {}) {
  const fake = fakeDeps({
    stateDir: '/unused',
    ...(options.ownerConfig === undefined ? {} : { ownerConfig: options.ownerConfig }),
  })
  fake.deps.references.mockReturnValue(references)
  const remove = vi.fn(options.remove ?? (async () => undefined))
  vi.mocked(checkoutHead).mockResolvedValue({ path: '/tree', kind: 'worktree', remove })
  vi.mocked(prepareCommand).mockImplementation(async (_args, target) => void target() as never)
  return { ...fake, remove }
}

const runEnv = (env: Record<string, string>) =>
  ({ env, tmp: '/tmp', git: vi.fn(), remote: vi.fn(), signals: undefined }) as never

const where = (env: Record<string, string> = { CODE_REVIEWER_CLONE_ROOT: '/clones' }) => ({
  title: 'Title',
  runDir: '/runs/head',
  models: { plan: DEFAULT_MODEL_PLAN },
  env: runEnv(env),
})

const approve = (fake: ReturnType<typeof setup>, env?: Record<string, string>) =>
  approveReplies(fake.deps as never, pull, plan, judgments, result, where(env))

afterEach(() => {
  vi.resetAllMocks()
  vi.unstubAllEnvs()
})

describe('approveReplies', () => {
  it('passes without a check when the machine config switched it off', async () => {
    const fake = setup({ ownerConfig: { approvalCheck: false } })
    expect(await approve(fake)).toMatchObject({ approval: { passed: true }, outcome: undefined })
    expect(checkoutHead).not.toHaveBeenCalled()
    expect(applyApprovalCheck).not.toHaveBeenCalled()
  })

  it('checks out the head, prepares the run, and gives what the replies removed to the check', async () => {
    const fake = setup()
    vi.mocked(applyApprovalCheck).mockResolvedValue(checked({}))
    const run = await approve(fake)
    expect(run).toMatchObject({ approval: { passed: true }, outcome: 'upheld', notes: [] })
    expect(checkoutHead).toHaveBeenCalledWith(
      expect.objectContaining({ repo: 'acme/widgets', headSha: HEAD, clones: '/clones' }),
    )
    expect(prepareCommand).toHaveBeenCalledWith(
      expect.objectContaining({ tree: '/tree', out: '/runs/head/replies-approval' }),
      expect.any(Function),
      fake.deps,
    )
    const [, target] = vi.mocked(prepareCommand).mock.calls[0] ?? []
    expect(target?.()).toEqual(pull)
    const [step] = vi.mocked(applyApprovalCheck).mock.calls[0] ?? []
    expect(step).toMatchObject({ enabled: true, mode: 'full', tree: '/tree' })
    expect(step?.input.findings.map((finding) => finding.title)).toEqual(['Naming'])
    expect(step?.input.dropped?.map((dropped) => dropped.finding.title)).toEqual(['Option removed'])
    expect(step?.input.dropped?.[0]?.reason).toContain('settled by the author: Declared.')
    expect(fake.remove).toHaveBeenCalledTimes(1)
  })

  it('refuses the approval, with the reason, when the check does not uphold it', async () => {
    const fake = setup()
    vi.mocked(applyApprovalCheck).mockResolvedValue(
      checked({ outcome: 'changed', note: 'It missed the migration.' }),
    )
    const run = await approve(fake)
    expect(run.outcome).toBe('not upheld')
    expect(run.approval.passed).toBe(false)
    expect(run.notes[0]).toContain('It missed the migration.')
  })

  it('refuses the approval when the check could not run', async () => {
    const fake = setup()
    vi.mocked(applyApprovalCheck).mockResolvedValue(
      checked({ outcome: 'failed', error: 'timed out' }),
    )
    const run = await approve(fake)
    expect(run.approval.passed).toBe(false)
    expect(run.notes[0]).toContain('the approval check could not run: timed out')
  })

  it('refuses the approval when the head cannot be checked out', async () => {
    const fake = setup()
    vi.mocked(checkoutHead).mockRejectedValue(new Error('no clone'))
    const run = await approve(fake)
    expect(run.approval.passed).toBe(false)
    expect(run.notes).toEqual(['the head could not be checked out: no clone'])
    expect(applyApprovalCheck).not.toHaveBeenCalled()
  })

  it('refuses the approval, and still removes the checkout, when the run cannot be prepared', async () => {
    const fake = setup()
    vi.mocked(prepareCommand).mockRejectedValue(new Error('no diff'))
    const run = await approve(fake)
    expect(run.approval.passed).toBe(false)
    expect(run.notes).toEqual(['the approval check could not be prepared: no diff'])
    expect(fake.remove).toHaveBeenCalledTimes(1)
  })

  it('reports a checkout that could not be removed, and works without a clone directory', async () => {
    const fake = setup({
      remove: async () => {
        throw new Error('busy')
      },
    })
    vi.mocked(applyApprovalCheck).mockResolvedValue(checked({}))
    const run = await approve(fake, {})
    expect(run.approval.passed).toBe(true)
    expect(run.notes).toEqual(['could not remove the checkout /tree: busy'])
    expect(checkoutHead).toHaveBeenCalledWith(expect.objectContaining({ clones: undefined }))
  })

  it('reads the process environment when none is given', async () => {
    const fake = setup()
    vi.stubEnv('CODE_REVIEWER_CLONE_ROOT', '/from-env')
    vi.mocked(applyApprovalCheck).mockResolvedValue(checked({}))
    const { env: _env, ...rest } = where()
    await approveReplies(fake.deps as never, pull, plan, judgments, result, rest)
    expect(checkoutHead).toHaveBeenCalledWith(expect.objectContaining({ clones: '/from-env' }))
  })
})
