import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import type { Exec } from '../benchmark/exec.mts'
import type { Answerable } from '../context/answerable.mts'
import type { ReviewPlan } from '../plan.mts'
import { runReview, type ReviewSteps } from './review.mts'
import { answerableOf, verifierContext } from './verifier-context.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const PLAN: ReviewPlan = {
  upToDate: false,
  mode: 'full',
  effort: 'high',
  sinceSha: null,
  pillars: [{ pillar: 'rules', model: 'sonnet' }],
  verifierModel: 'opus',
  skipped: [],
  reasons: [],
}
const NOTE: Answerable = {
  thread: 'PRT_1',
  login: 'codex[bot]',
  url: 'https://example.test/pull/4#discussion_r9',
  where: 'a.ts:1',
  text: 'Add a lock for this.',
  replies: [],
}
const SENTENCE = 'Never lock a parent row the transaction only reads.'
const result = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0, num_turns: 1, structured_output: structured })

async function run(context: object, answers = true) {
  const out = mkdtempSync(join(tmpdir(), 'review-restate-'))
  dirs.push(out)
  const calls: { prompt: string; schema: string }[] = []
  const exec: Exec = async (command, args) => {
    if (command === 'git') return ''
    const prompt = args[1] as string
    if (args[args.indexOf('--tools') + 1] === '') return result({ skills: ['answer-rules:locks'] })
    if (prompt.includes('VERIFIER prompt text')) {
      calls.push({ prompt, schema: args[args.indexOf('--json-schema') + 1] as string })
      return result({
        summary: 's',
        pullRequestSummary: 'p',
        findings: [],
        answers: [
          {
            thread: 'PRT_1',
            body: 'No lock is needed; the row is only read.',
            rule: { skill: 'answer-rules:locks', quote: SENTENCE },
          },
          { thread: 'PRT_7', body: 'Not listed.', at: 'a.ts:1' },
        ],
      })
    }
    return result({ findings: [] })
  }
  const steps = {
    claim: async () => ({ claimed: true }),
    prepare: async () => {
      mkdirSync(join(out, 'diff'), { recursive: true })
      writeFileSync(join(out, 'diff', 'INDEX.md'), '- a.ts')
      writeFileSync(join(out, 'diff.patch'), 'diff --git a/a.ts b/a.ts\n+x\n')
      writeFileSync(join(out, 'context.json'), JSON.stringify({ title: 'T', ...context }))
      return { headSha: 'd'.repeat(40), baseSha: 'c'.repeat(40), plan: PLAN }
    },
    abort: async () => undefined,
    preview: async () => ({ verdict: 'Request Changes', reviews: [] }),
    plugins: async () => ({
      enabled: [{ id: 'answer-rules@m', version: '1' }],
      installs: [{ name: 'answer-rules', installPath: fixture('plugins/answer-rules') }],
    }),
    evidence: async () => ({ sources: [], readGuide: async () => '' }),
    approvalCheck: false,
    rulePlugins: ['answer-rules'],
    answers,
    exec,
    references: fixture('references'),
  } as unknown as ReviewSteps
  await runReview(steps, { repo: 'acme/widgets', pr: 4, out, tree: '/tree', jobs: 1 })
  return {
    call: calls[0] as { prompt: string; schema: string },
    review: JSON.parse(readFileSync(join(out, 'review.json'), 'utf8')),
    report: readFileSync(join(out, 'report.md'), 'utf8'),
  }
}

describe('runReview with another reviewer note to answer', () => {
  it('gives the verifier the note and carries the checked answer into review.json and the report', async () => {
    const { call, review, report } = await run({ answerable: [NOTE] })
    expect(call.prompt).toContain("## Other reviewers' open notes you may answer")
    expect(call.prompt).toContain('PRT_1')
    expect(call.schema).toContain('answers')
    expect(review.answers).toEqual([
      {
        thread: 'PRT_1',
        body: 'No lock is needed; the row is only read.',
        rule: { skill: 'answer-rules:locks', quote: SENTENCE },
      },
    ])
    expect(report).toContain('### Answers to other reviewers (1)')
    expect(report).toContain('Not posted: answers[1] dropped: its thread was not listed')
  })

  it('adds no block, no schema field and no answers when the setting is off', async () => {
    const { call, review } = await run({ answerable: [NOTE] }, false)
    expect(call.prompt).not.toContain('you may answer')
    expect(call.schema).not.toContain('answers')
    expect(review).not.toHaveProperty('answers')
  })

  it('adds nothing when the list is empty', async () => {
    const { call, review } = await run({ answerable: [] })
    expect(call.prompt).not.toContain('you may answer')
    expect(call.schema).not.toContain('answers')
    expect(review).not.toHaveProperty('answers')
  })
})

describe('answerableOf', () => {
  it('reads the list from context.json and treats a missing or odd value as none', () => {
    const out = mkdtempSync(join(tmpdir(), 'answerable-of-'))
    dirs.push(out)
    const write = (value: object) => writeFileSync(join(out, 'context.json'), JSON.stringify(value))
    write({ answerable: [NOTE] })
    expect(answerableOf(out)).toEqual([NOTE])
    write({ answerable: 'x' })
    expect(answerableOf(out)).toEqual([])
    write({})
    expect(answerableOf(out)).toEqual([])
  })

  it('is part of the verifier context only when the setting is on', () => {
    const out = mkdtempSync(join(tmpdir(), 'answerable-ctx-'))
    dirs.push(out)
    writeFileSync(join(out, 'context.json'), JSON.stringify({ answerable: [NOTE] }))
    expect(verifierContext(out)).not.toHaveProperty('answerable')
    expect(verifierContext(out, false)).not.toHaveProperty('answerable')
    expect(verifierContext(out, true).answerable).toEqual([NOTE])
  })
})
