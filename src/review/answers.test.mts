import { describe, expect, it } from 'vitest'

import { MAX_ANSWERS, MAX_ANSWER_CHARS, readAnswer, renderAnswer } from './answers.mts'
import { ReviewError } from './finding.mts'
import { parseAnswers } from './finding-extras.mts'

const RULE = { skill: 'jong-skills:locks', quote: 'Take a lock only on a row it writes.' }

const read = (raw: unknown) => {
  const why: string[] = []
  return { answer: readAnswer(raw, why), why }
}

describe('readAnswer', () => {
  it('keeps a rule answer with its text and whitespace collapsed', () => {
    const { answer } = read({
      thread: 'PRT_1',
      body: ' No lock\n here. ',
      rule: { skill: ' jong-skills:locks ', quote: 'Take a lock only on a row it writes.' },
    })
    expect(answer).toEqual({ thread: 'PRT_1', body: 'No lock here.', rule: RULE })
  })

  it('keeps a code answer that names where the code contradicts the note', () => {
    expect(read({ thread: 'PRT_1', body: 'It is guarded.', at: 'src/a.ts:4' }).answer).toEqual({
      thread: 'PRT_1',
      body: 'It is guarded.',
      at: 'src/a.ts:4',
    })
  })

  it.each([
    ['no thread id', { body: 'x', at: 'a.ts' }],
    ['a thread id with odd characters', { thread: 'a b', body: 'x', at: 'a.ts' }],
    ['an empty body', { thread: 'T', body: ' ', at: 'a.ts' }],
    ['an over-long body', { thread: 'T', body: 'x'.repeat(MAX_ANSWER_CHARS + 1), at: 'a.ts' }],
    ['neither a rule nor a location', { thread: 'T', body: 'x' }],
    ['a rule without a quote', { thread: 'T', body: 'x', rule: { skill: 'a:b' } }],
    ['a null rule', { thread: 'T', body: 'x', rule: null }],
    [
      'a quote that is too short',
      { thread: 'T', body: 'x', rule: { skill: 'a:b', quote: 'lock' } },
    ],
    ['an @ mention in the body', { thread: 'T', body: 'ping @bob', at: 'a.ts' }],
    ['an @ mention in the location', { thread: 'T', body: 'x', at: '@bob' }],
    [
      'an @ mention in the quote',
      { thread: 'T', body: 'x', rule: { skill: 'a:b', quote: `${'q'.repeat(20)} @bob` } },
    ],
    ['a null entry', null],
  ])('drops %s and says why', (_name, raw) => {
    const { answer, why } = read(raw)
    expect(answer).toBeUndefined()
    expect(why.length).toBeGreaterThan(0)
  })
})

describe('renderAnswer', () => {
  it('ends a rule answer with the skill and the quoted sentence', () => {
    expect(renderAnswer({ thread: 'T', body: 'No lock.', rule: RULE })).toBe(
      'No lock.\n\nRule: jong-skills:locks: "Take a lock only on a row it writes."',
    )
  })

  it('adds the location to a rule answer that has one, and ends a code answer with it', () => {
    expect(renderAnswer({ thread: 'T', body: 'b', rule: RULE, at: 'a.ts:2' })).toContain(
      '" (`a.ts:2`)',
    )
    expect(renderAnswer({ thread: 'T', body: 'b', at: 'a.ts:2' })).toBe('b\n\n`a.ts:2`')
  })
})

describe('parseAnswers', () => {
  it('is nothing without the field or with an empty list', () => {
    expect(parseAnswers(undefined)).toEqual({})
    expect(parseAnswers([])).toEqual({})
  })

  it('keeps at most the cap', () => {
    const entry = { thread: 'T', body: 'x', at: 'a.ts' }
    expect(parseAnswers(Array.from({ length: MAX_ANSWERS + 2 }, () => entry)).answers).toHaveLength(
      MAX_ANSWERS,
    )
  })

  it('fails the input on a malformed field or entry', () => {
    expect(() => parseAnswers('x')).toThrow(ReviewError)
    expect(() => parseAnswers([{ thread: 'T', body: '' }])).toThrow(ReviewError)
  })
})
