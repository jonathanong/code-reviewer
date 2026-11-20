import { describe, expect, it } from 'vitest'

import { localAuthor, postOptions } from './post-options.mts'

const SHA = 'e'.repeat(40)
const context = (extra: object) => () => JSON.stringify({ headSha: SHA, ...extra })

describe('localAuthor', () => {
  it('reads the author from the context beside the input, for the same head only', () => {
    const read = (path: string) => {
      expect(path).toBe('/run/context.json')
      return JSON.stringify({ headSha: SHA, author: 'octocat' })
    }
    expect(localAuthor(read, '/run/review.json', SHA)).toEqual({ author: 'octocat' })
    expect(localAuthor(read, '/run/review.json', 'f'.repeat(40))).toEqual({})
  })

  it('returns nothing without a usable author or file', () => {
    expect(localAuthor(context({ author: null }), '/run/review.json', SHA)).toEqual({})
    expect(localAuthor(context({ author: '' }), '/run/review.json', SHA)).toEqual({})
    expect(
      localAuthor(
        () => {
          throw new Error('no file')
        },
        '/run/review.json',
        SHA,
      ),
    ).toEqual({})
    expect(localAuthor(() => 'not json', '/run/review.json', SHA)).toEqual({})
  })
})

describe('postOptions', () => {
  const read = context({ author: 'octocat' })

  it('defaults the targets and passes --allow-long and the author', () => {
    expect(postOptions({}, read, '/run/review.json', SHA)).toEqual({
      allowLong: false,
      textLimits: { bodyTarget: 1200, inlineTarget: 800 },
      author: 'octocat',
    })
    expect(postOptions({ 'allow-long': true }, read, '/run/review.json', SHA).allowLong).toBe(true)
  })

  it('takes the targets from the flags and rejects one that is not a positive integer', () => {
    expect(
      postOptions({ 'body-target': '300', 'inline-target': '90' }, read, '/run/review.json', SHA)
        .textLimits,
    ).toEqual({ bodyTarget: 300, inlineTarget: 90 })
    for (const bad of ['0', '-1', '1.5', 'many']) {
      expect(() => postOptions({ 'body-target': bad }, read, '/run/review.json', SHA)).toThrow(
        /--body-target must be a positive integer/u,
      )
    }
  })
})
