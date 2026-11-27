import { describe, expect, it } from 'vitest'

import { conversation } from './prepare-fake-io.mts'
import { checkList, requestFocus } from './request-focus.mts'

describe('checkList', () => {
  it('reads the items under a lead-in, with heading, bold, colon and checkbox marks stripped', () => {
    const text = [
      'Thanks for the quick turnaround.',
      '',
      '## **Please check:**',
      '',
      '- no wrappers or re-exports',
      '* [ ] a forwarding lambda is a wrapper',
      '2) the retry is bounded',
      '',
      'Unrelated paragraph.',
      '- not a point',
    ].join('\r\n')
    expect(checkList(text)).toEqual([
      'no wrappers or re-exports',
      'a forwarding lambda is a wrapper',
      'the retry is bounded',
    ])
  })

  it('takes text after the colon as the first point, with or without a list', () => {
    expect(checkList('Focus: no wrappers or re-exports')).toEqual(['no wrappers or re-exports'])
    expect(checkList('> Things to check: the retry\n- logging stays quiet')).toEqual([
      'the retry',
      'logging stays quiet',
    ])
  })

  it('ignores a lead-in with no list, and a sentence that only mentions checking', () => {
    expect(checkList('Focus\n\nSome prose follows.')).toEqual([])
    expect(checkList('Please check this out when you can.\n- item')).toEqual([])
    expect(checkList('Checks:\n- ')).toEqual([])
    expect(checkList('')).toEqual([])
  })

  it('uses the next lead-in when the first has no list', () => {
    expect(checkList('Focus\nprose\n\nChecks:\n- the real list')).toEqual(['the real list'])
  })
})

describe('requestFocus', () => {
  const comment = (login: string, body: string, createdAt: string, isMinimized = false) => ({
    author: { login },
    body,
    createdAt,
    isMinimized,
  })
  const pull = (body = '') => ({
    ...conversation(null, { login: 'Dev', __typename: 'User' }),
    body,
  })

  it('takes the requester newest comment that holds a list, not anyone else', () => {
    const base = pull()
    base.comments = {
      nodes: [
        comment('peer', 'Focus:\n- old list', '2026-01-01T00:00:00Z'),
        comment('peer', 'Focus:\n- new list', '2026-01-03T00:00:00Z'),
        comment('peer', 'no list here', '2026-01-04T00:00:00Z'),
        comment('peer', 'Focus:\n- hidden', '2026-01-05T00:00:00Z', true),
        comment('stranger', 'Focus:\n- stranger list', '2026-01-06T00:00:00Z'),
      ],
    }
    expect(requestFocus(base, 'Peer')).toEqual({
      points: ['new list'],
      source: "the requester's comment",
    })
  })

  it('falls back to the description only when the requester wrote it', () => {
    const base = pull('Summary\n\nReview focus:\n- the cache key')
    expect(requestFocus(base, 'dev')).toEqual({
      points: ['the cache key'],
      source: 'the pull request description',
    })
    expect(requestFocus(base, 'peer')).toBeUndefined()
    expect(requestFocus(pull('no list'), 'dev')).toBeUndefined()
    expect(requestFocus({ ...base, author: null }, 'dev')).toBeUndefined()
  })
})
