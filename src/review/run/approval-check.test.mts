import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import { readTranscript } from '../../harness/claude-stream.mts'
import { ExecError } from '../benchmark/exec.mts'
import type { Finding } from '../finding.mts'
import { APPROVAL_CHECK_SCHEMA, approvalCheckInput } from './approval-check-prompt.mts'
import {
  applyApprovalCheck,
  parseApprovalCheck,
  type ApprovalCheckStep,
} from './approval-check.mts'
import type { ReviewVerifierOutput } from './verify.mts'

const references = fileURLToPath(new URL('./fixtures/references', import.meta.url))
const RUN = { out: '/run', sinceSha: null, hasRules: false }
const NIT: Finding = { pillar: 'design', severity: 'low', title: 'Nit', body: 'n' }
const RAW: Finding[] = [
  { pillar: 'rules', severity: 'high', title: 'Real', body: 'r' },
  { pillar: 'design', severity: 'medium', title: 'Weak', body: 'w' },
  { pillar: 'rules', severity: 'low', title: 'Merged', body: 'm' },
]
const OUTPUT = {
  summary: 'It adds a widget.',
  pullRequestSummary: 'Adds a widget.',
  findings: [NIT],
  questions: [],
  sources: [[0, 2]],
  dropped: new Map([[1, 'Speculative.']]),
  fixedThreadIds: [],
  skills: [],
  usage: { costUsd: 1, turns: 2 },
} as unknown as ReviewVerifierOutput
const RESULTS = [
  { pillar: 'rules', error: undefined },
  { pillar: 'security', error: 'timed out' },
] as never

const result = (structured: unknown, cost = 0.5) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: cost,
    num_turns: 3,
    structured_output: structured,
  })

function step(overrides: Partial<ApprovalCheckStep> = {}): ApprovalCheckStep {
  return {
    enabled: true,
    mode: 'full',
    model: 'opus',
    tree: '/tree',
    exec: vi.fn(async () => result({ summary: 'Nothing refutes it.', findings: [] })),
    input: {
      ...approvalCheckInput(references, RUN, OUTPUT, RESULTS, RAW, []),
      findings: [],
      questions: [],
    },
    ...overrides,
  }
}

describe('approvalCheckInput', () => {
  const input = approvalCheckInput(references, RUN, OUTPUT, RESULTS, RAW, [])

  it('lists the pillars that answered and the findings the verifier dropped, with its reason', () => {
    expect(input.ran).toEqual(['rules'])
    expect(input.dropped).toEqual([{ finding: RAW[1], reason: 'Speculative.' }])
  })

  it('reads the approval check prompt from the references directory', () => {
    expect(input.prompt.trim()).toBe('APPROVAL CHECK prompt text')
  })

  it('gives a reason even when the verifier gave none', () => {
    const none = { ...OUTPUT, dropped: new Map() } as unknown as ReviewVerifierOutput
    expect(approvalCheckInput(references, RUN, none, RESULTS, RAW, []).dropped[0]?.reason).toBe(
      'No reason given.',
    )
  })
})

describe('parseApprovalCheck', () => {
  const parse = (stdout: string) => parseApprovalCheck(readTranscript(stdout, 'Approval check run'))

  it('reads findings, questions and the note', () => {
    const ask = { question: 'Q?', askOf: 'author', why: 'W' }
    const parsed = parse(result({ summary: ' Held. ', findings: [NIT], questions: [ask] }))
    expect(parsed).toMatchObject({ findings: [NIT], questions: [ask], note: 'Held.' })
    expect(parsed.usage.costUsd).toBe(0.5)
  })

  it('rejects output with no findings array', () => {
    expect(() => parse(result({ summary: 'x' }))).toThrow('no structured findings')
    expect(() => parse(JSON.stringify({ type: 'result' }))).toThrow('no structured findings')
  })

  it('requires a pillar on every finding', () => {
    expect(APPROVAL_CHECK_SCHEMA.properties.findings.items.required).toContain('pillar')
    expect(() => parse(result({ findings: [{ severity: 'low', title: 't', body: 'b' }] }))).toThrow(
      'findings[0].pillar',
    )
  })
})

describe('applyApprovalCheck', () => {
  it('runs nothing when it is switched off, the review is light, or the verdict is not Approve', async () => {
    for (const overrides of [{ enabled: false }, { mode: 'light' as const }]) {
      const off = step(overrides)
      expect((await applyApprovalCheck(off)).check).toBeUndefined()
      expect(off.exec).not.toHaveBeenCalled()
    }
    const high = step()
    high.input = { ...high.input, findings: [{ ...NIT, severity: 'high' }] }
    const outcome = await applyApprovalCheck(high)
    expect(outcome.check).toBeUndefined()
    expect(outcome.findings).toHaveLength(1)
    expect(high.exec).not.toHaveBeenCalled()
  })

  it('runs once on the verifier model with read-only tools and an isolated schema', async () => {
    const upheld = step()
    const outcome = await applyApprovalCheck(upheld)
    const [command, args, options] = vi.mocked(upheld.exec).mock.calls[0] as unknown as [
      string,
      string[],
      { cwd: string },
    ]
    expect(vi.mocked(upheld.exec)).toHaveBeenCalledTimes(1)
    expect(command).toBe('claude')
    expect(args[args.indexOf('--model') + 1]).toBe('opus')
    expect(args[args.indexOf('--tools') + 1]).toBe('Read,Grep,Glob,Skill')
    expect(args).not.toContain('--agents')
    expect(options.cwd).toBe('/tree')
    expect(args[1]).toContain('APPROVAL CHECK prompt text')
    expect(outcome.check).toMatchObject({
      outcome: 'upheld',
      verdictBefore: 'Approve',
      verdictAfter: 'Approve',
      note: 'Nothing refutes it.',
      findings: [],
    })
  })

  it('keeps the approval when the check adds only a low finding, and merges it', async () => {
    const exec = vi.fn(async () => result({ summary: 's', findings: [NIT] }))
    const outcome = await applyApprovalCheck(step({ exec }))
    expect(outcome.check?.outcome).toBe('upheld')
    expect(outcome.findings).toEqual([NIT])
  })

  it('turns the approval into a Comment when the check confirms a high finding', async () => {
    const high = { ...NIT, severity: 'high', title: 'Unreviewed file' }
    const exec = vi.fn(async () => result({ summary: 's', findings: [high] }))
    const outcome = await applyApprovalCheck(step({ exec }))
    expect(outcome.check).toMatchObject({ outcome: 'changed', verdictAfter: 'Comment' })
    expect(outcome.findings).toEqual([high])
  })

  it('turns the approval into Request Changes for a blocking finding', async () => {
    const blocking = { ...NIT, severity: 'blocking' }
    const exec = vi.fn(async () => result({ summary: 's', findings: [blocking] }))
    expect((await applyApprovalCheck(step({ exec }))).check?.verdictAfter).toBe('Request Changes')
  })

  it('turns the approval into a Comment when the check asks a question', async () => {
    const ask = { question: 'Q?', askOf: 'product', why: 'W' }
    const exec = vi.fn(async () => result({ summary: 's', findings: [], questions: [ask] }))
    const outcome = await applyApprovalCheck(step({ exec }))
    expect(outcome.check?.outcome).toBe('changed')
    expect(outcome.questions).toEqual([ask])
  })

  it('lists itself as skipped and degrades to Comment when the run fails', async () => {
    const exec = vi.fn(async () => {
      throw new ExecError('claude exited 1\nmore', 1, result({}, 0.25), new Error('x'))
    })
    const outcome = await applyApprovalCheck(step({ exec }))
    expect(exec).toHaveBeenCalledTimes(1)
    expect(outcome.check).toMatchObject({
      outcome: 'failed',
      verdictBefore: 'Approve',
      verdictAfter: 'Comment',
      error: 'claude exited 1',
    })
    expect(outcome.check?.usage?.costUsd).toBe(0.25)
    expect(outcome.skipped).toEqual([
      {
        pillar: 'approval-check',
        reason: expect.stringContaining('so this is a comment, not an approval'),
      },
    ])
  })

  it('treats unreadable output as a failure, never as an approval', async () => {
    const exec = vi.fn(async () => 'not json')
    const outcome = await applyApprovalCheck(step({ exec }))
    expect(outcome.check?.outcome).toBe('failed')
    expect(outcome.skipped).toHaveLength(1)
  })

  it('passes the settings to the run when given', async () => {
    const withSettings = step({ settings: { enabledPlugins: {} } })
    await applyApprovalCheck(withSettings)
    const args = vi.mocked(withSettings.exec).mock.calls[0]?.[1] as string[]
    expect(args).toContain('--settings')
  })
})
