import { describe, expect, it, vi } from 'vitest'

import { parseUsage } from '../../harness/claude-usage.mts'
import type { Answer } from '../answers.mts'
import type { Answerable } from '../context/answerable.mts'
import type { AnswerRules } from './answers-prompt.mts'
import { buildReport } from './report.mts'
import { renderReport } from './report-render.mts'
import { buildReviewInput } from './review-input.mts'
import { runReviewVerifier } from './verify-run.mts'
import type { ReviewVerifierOutput, VerifierInput } from './verify.mts'

const NOTE: Answerable = {
  thread: 'PRT_1',
  login: 'codex[bot]',
  url: 'https://example.test/c/1',
  where: 'src/a.ts:7',
  text: 'Add a lock here.',
  replies: [],
}
const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: null, hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}
const RULES: AnswerRules = {
  texts: new Map([['ratchet-workflows:locks', 'Take a lock only on a row it writes.']]),
  selected: ['ratchet-workflows:locks'],
}
const GIVEN = [
  {
    thread: 'PRT_1',
    body: 'No lock.',
    rule: { skill: 'ratchet-workflows:locks', quote: 'Take a lock only on a row it writes.' },
  },
  { thread: 'PRT_9', body: 'Made up.', at: 'a.ts:1' },
]
const reply = (answers: unknown) =>
  JSON.stringify({
    type: 'result',
    structured_output: { summary: 's', pullRequestSummary: 'p', findings: [], answers },
  })

const run = async (input: VerifierInput, answerRules?: AnswerRules) => {
  const exec = vi.fn(async () => reply(GIVEN))
  const output = await runReviewVerifier(input, {
    model: 'opus',
    mode: 'full',
    tree: '/t',
    exec,
    ...(answerRules === undefined ? {} : { answerRules }),
  })
  const args = (exec.mock.calls[0] as unknown as [string, string[]])[1] as string[]
  return { output, prompt: args[1] as string, schema: args[args.indexOf('--json-schema') + 1] }
}

describe('which verifier runs may answer', () => {
  it('lists the note, allows the field, and keeps only the answers that pass the guards', async () => {
    const { output, prompt, schema } = await run({ ...INPUT, answerable: [NOTE] }, RULES)
    expect(prompt).toContain("## Other reviewers' open notes you may answer")
    expect(schema).toContain('"answers"')
    expect(output.answers).toEqual([GIVEN[0]])
    expect(output.answerWarnings).toEqual([expect.stringContaining('its thread was not listed')])
  })

  it('drops an answer that cites a rule when the run holds no rule text', async () => {
    const { output } = await run({ ...INPUT, answerable: [NOTE] })
    expect(output.answers).toEqual([])
    expect(output.answerWarnings).toHaveLength(2)
  })

  it.each([
    ['no note was listed', INPUT],
    ['an empty list was given', { ...INPUT, answerable: [] }],
  ])('asks nothing and returns no answers when %s', async (_name, input) => {
    const { output, prompt, schema } = await run(input, RULES)
    expect(prompt).not.toContain('you may answer')
    expect(schema).not.toContain('answers')
    expect(output).not.toHaveProperty('answers')
    expect(output).not.toHaveProperty('answerWarnings')
  })
})

describe('the answers in review.json and report.md', () => {
  const usage = parseUsage({ total_cost_usd: 0, num_turns: 1 })
  const ANSWER: Answer = { thread: 'PRT_1', body: 'No lock.', at: 'src/a.ts:3' }
  const output = (extra: Partial<ReviewVerifierOutput> = {}): ReviewVerifierOutput => ({
    summary: 's',
    pullRequestSummary: 'p',
    findings: [],
    questions: [],
    sources: [],
    dropped: new Map(),
    fixedThreadIds: [],
    dependencies: [],
    skills: [],
    usage,
    ...extra,
  })
  const report = (out: ReviewVerifierOutput) =>
    buildReport({
      repo: 'acme/widgets',
      pr: 4,
      title: 'Lint',
      headSha: 'b'.repeat(40),
      mode: 'full',
      effort: 'high',
      reasons: [],
      verdict: 'Approve',
      skipped: [],
      skillSelection: { selected: [], available: 0, usage },
      pillars: [],
      verifier: { model: 'opus', output: out },
    })

  it('carries from the verifier to the review input, and is absent when there is none', () => {
    const parts = { effort: 'high', skipped: [], findings: [], questions: [], dependencies: [] }
    const run = { out: '/run', sinceSha: null, hasRules: false }
    const build = (out: ReviewVerifierOutput) =>
      buildReviewInput({ ...parts, effort: 'high', output: out, run })
    expect(build(output({ answers: [ANSWER] })).answers).toEqual([ANSWER])
    expect(build(output({ answers: [] }))).not.toHaveProperty('answers')
    expect(build(output())).not.toHaveProperty('answers')
  })

  it('is shown in the report with what was not posted, and not without either', () => {
    const shown = renderReport(
      report(output({ answers: [ANSWER], answerWarnings: ['answers[1] dropped: x'] })),
    )
    expect(shown).toContain('### Answers to other reviewers (1)')
    expect(shown).toContain('thread `PRT_1`')
    expect(shown).toContain('> No lock.')
    expect(shown).toContain('- Not posted: answers[1] dropped: x')
    expect(renderReport(report(output({ answers: [], answerWarnings: [] })))).not.toContain(
      'Answers to other reviewers',
    )
    expect(renderReport(report(output()))).not.toContain('Answers to other reviewers')
  })

  it('shows a warning even when every answer was dropped', () => {
    const shown = renderReport(report(output({ answers: [], answerWarnings: ['w'] })))
    expect(shown).toContain('### Answers to other reviewers (0)')
  })
})
