import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { ExecError } from '../benchmark/exec.mts'
import type { Finding } from '../finding.mts'
import { approvalCheckInput } from './approval-check-prompt.mts'
import { applyApprovalCheck, type ApprovalCheckStep } from './approval-check.mts'
import type { ReviewVerifierOutput } from './verify.mts'

const references = fileURLToPath(new URL('./fixtures/references', import.meta.url))
const RUN = { out: '/run', sinceSha: null, hasRules: false }
const MEDIUM: Finding = { pillar: 'correctness', severity: 'medium', title: 'Gap', body: 'b' }
const ASK = { question: 'Q?', askOf: 'author', why: 'W' }
const OUTPUT = {
  summary: 'I found nothing to fix.',
  pullRequestSummary: 'Adds a widget.',
  findings: [],
  questions: [],
  sources: [],
  dropped: new Map(),
} as unknown as ReviewVerifierOutput

const answer = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

const step = (exec: ApprovalCheckStep['exec']): ApprovalCheckStep => ({
  enabled: true,
  mode: 'full',
  model: 'opus',
  tree: '/tree',
  exec,
  input: approvalCheckInput(references, RUN, OUTPUT, [], [], []),
})

const run = (structured: unknown) => applyApprovalCheck(step(vi.fn(async () => answer(structured))))

describe('the summary the approval check hands back', () => {
  it('is the rewritten summary when the check adds a finding and provides one', async () => {
    const outcome = await run({
      summary: 'note',
      reviewSummary: ' One medium finding remains. ',
      findings: [MEDIUM],
    })
    expect(outcome.summary).toBe('One medium finding remains.')
  })

  it('is the rewritten summary when the check adds only a question', async () => {
    const outcome = await run({
      summary: 'n',
      reviewSummary: 'One open question.',
      findings: [],
      questions: [ASK],
    })
    expect(outcome.summary).toBe('One open question.')
  })

  it('is absent when the check adds nothing, even if it returns one', async () => {
    const outcome = await run({ summary: 'n', reviewSummary: 'Rewritten.', findings: [] })
    expect(outcome.check?.outcome).toBe('upheld')
    expect(outcome.summary).toBeUndefined()
  })

  it.each([
    ['missing', {}],
    ['empty', { reviewSummary: '' }],
    ['blank', { reviewSummary: '  \n' }],
    ['not a string', { reviewSummary: 3 }],
  ])('is absent when the check adds a finding and its summary is %s', async (_, extra) => {
    const outcome = await run({ summary: 'n', findings: [MEDIUM], ...extra })
    expect(outcome.check?.outcome).toBe('upheld')
    expect(outcome.findings).toEqual([MEDIUM])
    expect(outcome.summary).toBeUndefined()
  })

  it('is absent when the check fails', async () => {
    const exec = vi.fn(async () => {
      throw new ExecError('claude exited 1', 1, answer({}), new Error('x'))
    })
    const outcome = await applyApprovalCheck(step(exec))
    expect(outcome.check?.outcome).toBe('failed')
    expect(outcome.summary).toBeUndefined()
  })
})
