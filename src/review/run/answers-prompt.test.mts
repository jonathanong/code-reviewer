import { describe, expect, it } from 'vitest'

import { MAX_ANSWERS } from '../answers.mts'
import type { Answerable } from '../context/answerable.mts'
import { normalizeLines } from './answers-quote.mts'
import { answerLines, checkedAnswers, withAnswers, type AnswerRules } from './answers-prompt.mts'
import { REVIEW_VERIFIER_SCHEMA, buildVerifierRunPrompt, type VerifierInput } from './verify.mts'

const item = (thread: string): Answerable => ({
  thread,
  login: 'codex[bot]',
  url: `https://example.test/c/${thread}`,
  where: 'src/a.ts:7',
  text: 'Add a lock here.',
  replies: [],
})

const INPUT: VerifierInput = {
  verifierPrompt: 'VERIFIER',
  references: '/refs',
  run: { out: '/run', sinceSha: null, hasRules: true },
  findings: [],
  skipped: [],
  threads: [],
}

const SENTENCE = 'Never lock a parent row the transaction only reads.'
const RULES: AnswerRules = {
  texts: new Map([
    ['jong-skills:locks', `# Locks\n- Take a lock only on a row it writes.\n- ${SENTENCE}`],
    ['jong-skills:other', `- ${SENTENCE}`],
  ]),
  selected: ['jong-skills:locks'],
}
const given = (thread: string, extra: object = {}) => ({
  thread,
  body: 'No lock here.',
  at: 'src/a.ts:3',
  ...extra,
})
const check = (raw: unknown, loaded: string[] = []) =>
  checkedAnswers(raw, [item('T1'), item('T2')], RULES, loaded)

describe('the answers block', () => {
  it('leaves the prompt and the schema as they are without a listed note', () => {
    const plain = buildVerifierRunPrompt(INPUT)
    expect(buildVerifierRunPrompt({ ...INPUT, answerable: [] })).toBe(plain)
    expect(withAnswers(REVIEW_VERIFIER_SCHEMA, undefined)).toBe(REVIEW_VERIFIER_SCHEMA)
    expect(withAnswers(REVIEW_VERIFIER_SCHEMA, [])).toBe(REVIEW_VERIFIER_SCHEMA)
    expect(answerLines(undefined)).toEqual([])
    expect(JSON.stringify(REVIEW_VERIFIER_SCHEMA)).not.toContain('answers')
  })

  it('adds a labelled block with the listed thread ids, before the untrusted-data line', () => {
    const prompt = buildVerifierRunPrompt({ ...INPUT, answerable: [item('T1')] })
    expect(prompt).toContain("## Other reviewers' open notes you may answer")
    expect(prompt).toContain('"thread": "T1"')
    expect(prompt.indexOf('## Other reviewers')).toBeLessThan(prompt.indexOf('untrusted data'))
  })

  it('allows an optional answers list in the schema, and changes no other property', () => {
    const schema = withAnswers(REVIEW_VERIFIER_SCHEMA, [item('T1')])
    expect(schema.properties).toHaveProperty('answers')
    expect(schema.required).toEqual(REVIEW_VERIFIER_SCHEMA.required)
    expect(schema.properties.findings).toBe(REVIEW_VERIFIER_SCHEMA.properties.findings)
  })
})

describe('checkedAnswers', () => {
  it('keeps an answer on a listed thread with a location, and one with a quoted rule', () => {
    const rule = { skill: 'jong-skills:locks', quote: SENTENCE }
    expect(check([given('T1'), given('T2', { rule, at: undefined })])).toEqual({
      answers: [given('T1'), { thread: 'T2', body: 'No lock here.', rule }],
      warnings: [],
    })
  })

  it('reads a quote across the skill line breaks, and a skill the verifier loaded', () => {
    const wrapped = { skill: 'jong-skills:other', quote: SENTENCE.replace(' ', '\n  ') }
    expect(check([given('T1', { rule: wrapped })]).answers).toEqual([]) // not selected, not loaded
    expect(check([given('T1', { rule: wrapped })], ['jong-skills:other']).answers).toHaveLength(1)
  })

  it.each([
    ['a thread that was not listed', given('T9'), 'not listed'],
    ['an answer without a basis', { thread: 'T1', body: 'No.' }, 'no rule and no location'],
    ['a mention', given('T1', { body: 'cc @bob' }), 'mentions'],
    [
      'a quote the skill does not hold',
      given('T1', { rule: { skill: 'jong-skills:locks', quote: 'Always lock the whole table.' } }),
      'quote is not in the skill',
    ],
    [
      'a skill that is not installed',
      given('T1', { rule: { skill: 'jong-skills:none', quote: SENTENCE } }),
      'not a loaded rule skill',
    ],
  ])('drops %s and warns', (_name, entry, reason) => {
    const { answers, warnings } = check([entry])
    expect(answers).toEqual([])
    expect(warnings).toEqual([expect.stringContaining(reason)])
  })

  it('keeps a whole sentence or list item and drops the tail of one', () => {
    const skill = `# Locks\n\n- Never lock a parent row the transaction only reads.\n- Prefer short   transactions. Keep every transaction\n  small and short.`
    const rules: AnswerRules = {
      texts: new Map([['jong-skills:locks', normalizeLines(skill)]]),
      selected: ['jong-skills:locks'],
    }
    const quote = (text: string) => [
      given('T1', { rule: { skill: 'jong-skills:locks', quote: text } }),
    ]
    const kept = (text: string) =>
      checkedAnswers(quote(text), [item('T1')], rules, []).answers.length
    expect(kept('Never lock a parent row the transaction only reads.')).toBe(1)
    expect(kept('Prefer short transactions.')).toBe(1)
    expect(kept('Keep every transaction small and short.')).toBe(1)
    expect(kept('lock a parent row the transaction only reads.')).toBe(0)
    expect(kept('Never lock a parent row')).toBe(0)
  })

  it('drops a second answer on a thread and everything past the cap', () => {
    expect(check([given('T1'), given('T1')]).warnings).toEqual([
      expect.stringContaining('a second answer'),
    ])
    const many = Array.from({ length: MAX_ANSWERS + 1 }, (_, at) => given(`T${at}`))
    const listed = many.map((entry) => item(entry.thread))
    const { answers, warnings } = checkedAnswers(many, listed, RULES, [])
    expect(answers).toHaveLength(MAX_ANSWERS)
    expect(warnings).toEqual([expect.stringContaining(`more than ${MAX_ANSWERS}`)])
  })

  it('is empty for anything that is not a list', () => {
    expect(check('x')).toEqual({ answers: [], warnings: [] })
    expect(check(undefined)).toEqual({ answers: [], warnings: [] })
  })

  it('keeps nothing when no note was listed', () => {
    expect(checkedAnswers([given('T1')], undefined, RULES, []).answers).toEqual([])
  })
})
