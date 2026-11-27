import { describe, expect, it } from 'vitest'

import type { PrConversation, ReviewThread, ThreadComment } from '../context-query.mts'
import { answerableThreads } from '../context/answerable.mts'
import { normalizeLines } from '../run/answers-quote.mts'
import type { AnswerableCase } from './answerable-case.mts'
import type { EvalCase } from './cases.mts'
import { gradeAnswers, notesOf } from './verifier-answers.mts'
import { buildVerifierPrompt } from './verifier-prompt.mts'
import { verifierRequest, VERIFIER_OUTPUT_SCHEMA } from './verifier-run.mts'

const SKILL = 'ratchet-backend:postgres-locking'
const SENTENCE = 'Append-only writes never lock: votes, events, history.'
const RULES = {
  texts: new Map([
    [SKILL, normalizeLines(`# Locking\n\n- ${SENTENCE}\n`)],
    ['ratchet-workflows:other', normalizeLines(`# Other\n\n- ${SENTENCE}\n`)],
  ]),
  selected: [],
}
const note = (thread: string) => ({
  thread,
  login: 'reviewer-one',
  url: `https://example.test/c/${thread}`,
  where: 'src/a.ts:3',
  text: 'Add a lock.',
  replies: [],
})
const CASES: AnswerableCase[] = [
  { note: note('T1'), expect: { answer: SKILL } },
  { note: note('T2'), expect: 'leave' },
]
const reply = (thread: string, skill: string) => ({
  thread,
  body: 'No lock is needed.',
  rule: { skill, quote: SENTENCE },
})

describe('gradeAnswers', () => {
  it('passes an answer that cites the expected skill and a note left alone', () => {
    const grade = gradeAnswers(CASES, [reply('T1', SKILL)], RULES, [SKILL])
    expect(grade.threads).toEqual([
      { thread: 'T1', expect: { answer: SKILL }, answered: true, cited: SKILL, passed: true },
      { thread: 'T2', expect: 'leave', answered: false, passed: true },
    ])
    expect(grade.answers).toHaveLength(1)
    expect(grade.loaded).toEqual([SKILL])
  })

  it('fails an answer that cites another skill, cites none, or is missing', () => {
    const other = gradeAnswers(CASES, [reply('T1', 'ratchet-workflows:other')], RULES, [
      'ratchet-workflows:other',
    ])
    expect(other.threads[0]).toMatchObject({
      answered: true,
      cited: 'ratchet-workflows:other',
      passed: false,
    })
    const code = gradeAnswers(CASES, [{ thread: 'T1', body: 'No.', at: 'src/a.ts:3' }], RULES, [])
    expect(code.threads[0]).toEqual({
      thread: 'T1',
      expect: { answer: SKILL },
      answered: true,
      passed: false,
    })
    expect(gradeAnswers(CASES, undefined, RULES, []).threads[0]?.passed).toBe(false)
  })

  it('drops an answer the production checks drop, so it does not count', () => {
    const unloaded = gradeAnswers(CASES, [reply('T1', SKILL)], RULES, [])
    expect(unloaded.answers).toEqual([])
    expect(unloaded.threads[0]?.passed).toBe(false)
    expect(unloaded.warnings[0]).toContain('not a loaded rule skill')
    const unlisted = gradeAnswers(CASES, [reply('T9', SKILL)], RULES, [SKILL])
    expect(unlisted.warnings).toEqual(['answers[0] dropped: its thread was not listed'])
  })

  it('fails a leave note the verifier answered, even with a valid rule', () => {
    const grade = gradeAnswers(CASES, [reply('T2', SKILL)], RULES, [SKILL])
    expect(grade.threads[1]).toMatchObject({ answered: true, passed: false })
  })
})

describe('the prompt and schema of a case', () => {
  const item = {
    id: 'c',
    fixture: 'f',
    fixtureDir: '/f',
    title: 'T',
    kind: 'negative',
    reason: '',
    expected: [],
  } as EvalCase

  it('are unchanged for a case without notes', () => {
    const plain = buildVerifierPrompt('V', item, [], true, undefined)
    expect(buildVerifierPrompt('V', item, [], true, undefined, undefined)).toBe(plain)
    expect(plain).not.toContain("Other reviewers' open notes")
    expect(notesOf(item)).toBeUndefined()
    const request = verifierRequest('P', 'opus', 5, true)
    expect(request.schema).toBe(VERIFIER_OUTPUT_SCHEMA)
    expect(request).not.toHaveProperty('transcript')
  })

  it('carry the production block, the answers schema and a transcript for a case with notes', () => {
    const notes = notesOf({ answerable: CASES })
    const prompt = buildVerifierPrompt('V', item, [], true, undefined, notes)
    expect(prompt).toContain("## Other reviewers' open notes you may answer")
    expect(prompt).toContain('"thread": "T1"')
    expect(prompt.indexOf('"thread": "T1"')).toBeLessThan(prompt.indexOf('## Pillar findings'))
    const request = verifierRequest('P', 'opus', 5, true, undefined, notes)
    expect(request.schema).toHaveProperty('properties.answers')
    expect(request.transcript).toBe(true)
  })
})

describe('a thread the reviewer already replied in', () => {
  const comment = (login: string): ThreadComment => ({
    url: 'https://example.test/c/1',
    author: { login },
    body: 'Add a lock.',
    createdAt: '2026-11-01T00:00:00Z',
    pullRequestReview: null,
  })
  const thread = (...nodes: ThreadComment[]): ReviewThread => ({
    id: 'PRRT_1',
    isResolved: false,
    isOutdated: false,
    path: 'src/a.ts',
    line: 7,
    comments: { totalCount: nodes.length, nodes },
  })
  const pull = (...threads: ReviewThread[]) =>
    ({ reviewThreads: { nodes: threads } }) as unknown as PrConversation
  const own = new Set(['reviewer-app'])

  // A bench case lists notes after this filter, so "filtered before the prompt" is covered here.
  it('never reaches the prompt as an answerable note', () => {
    const replied = pull(thread(comment('reviewer-one'), comment('reviewer-app')))
    expect(answerableThreads(replied, own)).toEqual([])
    const item = {
      id: 'c',
      fixture: 'f',
      fixtureDir: '/f',
      title: 'T',
      kind: 'negative',
    } as EvalCase
    const prompt = buildVerifierPrompt(
      'V',
      item,
      [],
      false,
      undefined,
      answerableThreads(replied, own),
    )
    expect(prompt).not.toContain("Other reviewers' open notes")
    expect(answerableThreads(pull(thread(comment('reviewer-one'))), own)).toHaveLength(1)
  })
})
