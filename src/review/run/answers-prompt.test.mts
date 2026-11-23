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

const NOT_IN_SKILL = 'it is not a whole sentence of the skill, or is too short'
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
      'a skill that is not installed',
      given('T1', { rule: { skill: 'jong-skills:none', quote: SENTENCE } }),
      'not a loaded rule skill',
    ],
    [
      'a skill that is installed but neither selected nor loaded',
      given('T1', { rule: { skill: 'jong-skills:other' } }),
      'not a loaded rule skill',
    ],
  ])('drops %s and warns', (_name, entry, reason) => {
    const { answers, warnings } = check([entry])
    expect(answers).toEqual([])
    expect(warnings).toEqual([expect.stringContaining(reason)])
  })

  it('keeps an answer that names a skill without a quote', () => {
    const rule = { skill: 'jong-skills:locks' }
    expect(check([given('T1', { rule, at: undefined })])).toEqual({
      answers: [{ thread: 'T1', body: 'No lock here.', rule }],
      warnings: [],
    })
  })

  it.each([
    ['a quote the skill does not hold', 'Always lock the whole table.'],
    ['a quote that is too short', 'lock'],
  ])('removes %s, keeps the answer with its skill, and warns', (_name, quote) => {
    const rule = { skill: 'jong-skills:locks', quote }
    expect(check([given('T1', { rule })])).toEqual({
      answers: [given('T1', { rule: { skill: 'jong-skills:locks' } })],
      warnings: ['answers[0] kept without its quote: ' + NOT_IN_SKILL],
    })
  })

  it("carries the skill's link from the rules, and not one the model wrote", () => {
    const url = 'https://github.com/jonathanong/no-mistakes/blob/HEAD/skills/locks/SKILL.md'
    const rules = { ...RULES, links: new Map([['jong-skills:locks', url]]) }
    const rule = { skill: 'jong-skills:locks', quote: SENTENCE, url: 'https://evil.example/x' }
    const one = (links: AnswerRules) =>
      checkedAnswers([given('T1', { rule })], [item('T1')], links, []).answers[0]?.rule
    expect(one(rules)).toEqual({ skill: 'jong-skills:locks', quote: SENTENCE, url })
    expect(one(RULES)).toEqual({ skill: 'jong-skills:locks', quote: SENTENCE })
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
      checkedAnswers(quote(text), [item('T1')], rules, []).answers[0]?.rule?.quote === undefined
        ? 0
        : 1
    expect(kept('Never lock a parent row the transaction only reads.')).toBe(1)
    expect(kept('Prefer short transactions.')).toBe(1)
    expect(kept('Keep every transaction small and short.')).toBe(1)
    expect(kept('lock a parent row the transaction only reads.')).toBe(0)
    expect(kept('Never lock a parent row')).toBe(0)
  })

  it('does not take a wrapped line as the start or the end of a unit', () => {
    const skill = [
      '- Never',
      '  lock a parent row the transaction only reads.',
      '',
      'Prefer short transactions that',
      'hold few locks at once.',
      '## Notes',
      'Release locks early.',
      '',
    ].join('\n')
    const rules: AnswerRules = {
      texts: new Map([['jong-skills:locks', normalizeLines(skill)]]),
      selected: ['jong-skills:locks'],
    }
    const kept = (text: string) =>
      checkedAnswers(
        [given('T1', { rule: { skill: 'jong-skills:locks', quote: text } })],
        [item('T1')],
        rules,
        [],
      ).answers[0]?.rule?.quote === undefined
        ? 0
        : 1
    expect(kept('Never lock a parent row the transaction only reads.')).toBe(1)
    expect(kept('lock a parent row the transaction only reads.')).toBe(0)
    expect(kept('Prefer short transactions that hold few locks at once.')).toBe(1)
    expect(kept('Prefer short transactions that')).toBe(0)
    expect(kept('hold few locks at once.')).toBe(0)
    expect(kept('Release locks early.')).toBe(1)
    expect(kept('Never lock')).toBe(0)
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
