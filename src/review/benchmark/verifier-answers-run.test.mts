import { describe, expect, it } from 'vitest'

import { normalizeLines } from '../run/answers-quote.mts'
import type { EvalCase } from './cases.mts'
import type { Graded } from './verifier-grade.mts'
import { renderVerifierTable, scoreVerifierCase, summarizeVerifier } from './verifier-score.mts'
import { runVerifier } from './verifier-run.mts'

const SKILL = 'jong-skills:postgres-locking'
const SENTENCE = 'Append-only writes never lock: votes, events, history.'
const RULES = { texts: new Map([[SKILL, normalizeLines(`# L\n\n- ${SENTENCE}\n`)]]), selected: [] }

const item = {
  id: 'c',
  fixture: 'f',
  fixtureDir: '/f',
  title: 'T',
  kind: 'negative',
  reason: '',
  expected: [],
  answerable: [
    {
      note: {
        thread: 'T1',
        login: 'reviewer-one',
        url: 'https://example.test/c/1',
        where: 'src/a.ts:3',
        text: 'Add a lock.',
        replies: [],
      },
      expect: { answer: SKILL },
    },
  ],
} as EvalCase

const stream = (answers: unknown, loaded: string[]) =>
  [
    ...loaded.flatMap((skill, at) => [
      {
        type: 'assistant',
        message: { content: [{ type: 'tool_use', id: `u${at}`, name: 'Skill', input: { skill } }] },
      },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `u${at}` }] } },
    ]),
    { type: 'result', structured_output: { summary: 's', findings: [], answers } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n')

const RUN = { verifierPrompt: 'V', model: 'opus', maxTurns: 5 }
const answer = { thread: 'T1', body: 'No lock.', rule: { skill: SKILL, quote: SENTENCE } }

describe('runVerifier with notes to answer', () => {
  it('grades the answers against the skills the run loaded', async () => {
    const seen: string[][] = []
    const exec = async (_command: string, args: string[]) => {
      seen.push(args)
      return stream([answer], [SKILL])
    }
    const result = await runVerifier(item, '/snap', [], RUN, exec, RULES)
    expect(result.answers?.threads).toMatchObject([{ thread: 'T1', cited: SKILL, passed: true }])
    expect(result.answers?.loaded).toEqual([SKILL])
    expect(seen[0]?.[1]).toContain("Other reviewers' open notes you may answer")
    expect(seen[0]).toContain('stream-json')
  })

  it('fails a thread when the skill was not loaded, or when no rules were read', async () => {
    const unloaded = await runVerifier(
      item,
      '/snap',
      [],
      RUN,
      async () => stream([answer], []),
      RULES,
    )
    expect(unloaded.answers?.threads[0]?.passed).toBe(false)
    const unread = await runVerifier(item, '/snap', [], RUN, async () => stream([answer], [SKILL]))
    expect(unread.answers?.threads[0]?.passed).toBe(false)
  })

  it('reports no answers for a case without notes', async () => {
    const { answerable: _answerable, ...plain } = item as EvalCase & { answerable: unknown }
    const result = await runVerifier(plain as EvalCase, '/snap', [], RUN, async () =>
      JSON.stringify({ structured_output: { summary: 's', findings: [] } }),
    )
    expect(result).not.toHaveProperty('answers')
  })
})

describe('scoring the answers', () => {
  const graded: Graded = { judge: 'j', checker: 'k', inputs: 'i', added: [], checks: [] }
  const input = { findings: [], real: [], planted: [] }
  const output = { summary: '', findings: [], questions: [], sources: [] }
  const threads = [
    { thread: 'T1', expect: { answer: SKILL }, answered: true, cited: SKILL, passed: true },
    { thread: 'T2', expect: 'leave' as const, answered: true, passed: false },
  ]

  it('counts each thread and renders the line only when a case listed notes', () => {
    const scored = scoreVerifierCase(item, input, output, graded, {
      threads,
      answers: [],
      warnings: [],
      loaded: [],
    })
    expect(scored.threads).toEqual(threads)
    const summary = summarizeVerifier([scored])
    expect([summary.threads, summary.threadsPassed]).toEqual([2, 1])
    expect(renderVerifierTable(summary)).toContain(
      "Answers to other reviewers' notes: 1 of 2 handled as expected.",
    )
    const none = summarizeVerifier([scoreVerifierCase(item, input, output, graded)])
    expect(none.threads).toBe(0)
    expect(renderVerifierTable(none)).not.toContain('Answers to other reviewers')
  })
})
