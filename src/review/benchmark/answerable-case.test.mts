import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { parseAnswerable } from './answerable-case.mts'
import { parseEvalCases } from './cases.mts'

const note = {
  thread: 'PRRT_1',
  login: 'reviewer-one',
  url: 'https://example.test/c/1',
  where: 'src/a.ts:3',
  text: 'Add a lock.',
  replies: [{ login: 'alice', text: 'Why?' }],
}
const entry = (extra: object = {}) => ({ note, expect: 'leave', ...extra })
const fail = (raw: unknown, message: string) =>
  expect(() => parseAnswerable(raw, 'cases[0]')).toThrow(message)

describe('parseAnswerable', () => {
  it('adds nothing for a case without the field', () => {
    expect(parseAnswerable(undefined, 'w')).toEqual({})
  })

  it('reads the note, the expected outcome and the skill an answer must cite', () => {
    const parsed = parseAnswerable(
      [
        entry({ expect: 'answer', skill: 'jong-skills:postgres-locking' }),
        { note: { ...note, thread: 'PRRT_2', omitted: 2 }, expect: 'leave' },
      ],
      'w',
    )
    expect(parsed.answerable).toEqual([
      { note, expect: { answer: 'jong-skills:postgres-locking' } },
      { note: { ...note, thread: 'PRRT_2', omitted: 2 }, expect: 'leave' },
    ])
  })

  it('refuses a malformed list or entry', () => {
    fail([], 'answerable must list 1 to 10 notes')
    fail('x', 'answerable must list 1 to 10 notes')
    fail(
      Array.from({ length: 11 }, () => entry()),
      'answerable must list 1 to 10 notes',
    )
    fail([null], 'answerable[0]: must be an object')
    fail([{ expect: 'leave' }], 'answerable[0]: note must be an object')
    fail([entry({ expect: 'maybe' })], 'expect must be answer or leave')
    fail([entry({ skill: 'a:b' })], 'a leave note names no skill')
    fail([entry({ expect: 'answer' })], 'names its skill as plugin:skill')
    fail([entry({ expect: 'answer', skill: 'postgres-locking' })], 'names its skill')
    fail([entry(), entry()], 'threads must be unique')
  })

  it('refuses a malformed note', () => {
    const bad = (extra: object, message: string) =>
      fail([{ note: { ...note, ...extra }, expect: 'leave' }], message)
    bad({ thread: '' }, 'thread must be a non-empty string')
    bad({ text: 3 }, 'text must be a non-empty string')
    bad({ replies: 'x' }, 'replies must be an array')
    bad({ replies: [null] }, 'replies[0]: must be an object')
    bad({ replies: [{ login: 'a' }] }, 'replies[0]: text must be a non-empty string')
    bad({ omitted: 0 }, 'omitted must be a positive integer')
  })
})

describe('the answers cases', () => {
  const path = new URL('../../../benchmarks/review/answers.json', import.meta.url)

  it('parse, and every note lists the thread its case expects', () => {
    const cases = parseEvalCases(JSON.parse(readFileSync(path, 'utf8')) as unknown, 'benchmarks')
    expect(cases.map((item) => item.id)).toEqual([
      'answers-like-row-lock',
      'answers-floating-promise',
    ])
    expect(cases.map((item) => item.answerable?.map((entry) => entry.expect))).toEqual([
      [{ answer: 'jong-skills:postgres-locking' }],
      ['leave'],
    ])
  })
})
