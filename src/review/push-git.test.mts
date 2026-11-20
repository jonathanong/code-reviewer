import { describe, expect, it } from 'vitest'

import { mergeBase, nonTrivialRangeDiff, supportsRemerge } from './push-git.mts'

const answering = (text: string) => async () => text

describe('supportsRemerge', () => {
  it.each([
    ['git version 2.36.0', true],
    ['git version 2.39.5 (Apple Git-154)', true],
    ['git version 3.0.1', true],
    ['git version 2.35.9', false],
    ['git version 1.9.0', false],
    ['not a version', false],
  ])('reads %s', async (output, expected) => {
    expect(await supportsRemerge(answering(output))).toBe(expected)
  })
})

describe('nonTrivialRangeDiff', () => {
  const header = '    @@ Metadata\n     ## Commit message ##\n'
  it('is empty when every old commit pairs with a new one, identical or not', async () => {
    const out = `1:  aaaaaaa = 1:  bbbbbbb one\n2:  ccccccc ! 2:  ddddddd two\n${header}`
    expect(await nonTrivialRangeDiff(answering(out), 'a..b', 'c..d')).toBe('')
    expect(await nonTrivialRangeDiff(answering(''), 'a..b', 'c..d')).toBe('')
  })

  it.each(['<', '>'])('keeps the output when a commit was squashed or added (%s)', async (mark) => {
    const out = `1:  aaaaaaa = 1:  bbbbbbb one\n2:  ccccccc ${mark} -:  ddddddd two\n`
    expect(await nonTrivialRangeDiff(answering(out), 'a..b', 'c..d')).toBe(out)
  })
})

describe('mergeBase', () => {
  it('is undefined when git answers nothing or fails, and the trimmed sha otherwise', async () => {
    expect(await mergeBase(answering('abc\n'), 'a', 'b')).toBe('abc')
    expect(await mergeBase(answering('\n'), 'a', 'b')).toBeUndefined()
    expect(await mergeBase(() => Promise.reject(new Error('none')), 'a', 'b')).toBeUndefined()
  })
})
