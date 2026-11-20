import { describe, expect, it } from 'vitest'

import { dependencyRefs, extractRefs, refKey, refName } from './links-refs.mts'

const SELF = { repo: 'acme/widgets', number: 9 }

describe('extractRefs', () => {
  it('reads local, cross-repository and URL references in order, once each', () => {
    const text =
      'See #4, acme/lib#12 and https://github.com/other/svc/pull/7. Again #4 and acme/lib#12.'
    expect(extractRefs(text, SELF)).toEqual([
      { repo: 'acme/widgets', number: 4 },
      { repo: 'acme/lib', number: 12 },
      { repo: 'other/svc', number: 7 },
    ])
  })

  it('reads an issue URL and a pull request URL, and keeps a URL out of the local pattern', () => {
    const refs = extractRefs(
      'https://github.com/acme/widgets/issues/3 https://github.com/acme/widgets/pull/3#issuecomment-1',
      SELF,
    )
    expect(refs).toEqual([{ repo: 'acme/widgets', number: 3 }])
  })

  it('skips the pull request itself, code spans, fenced code, and look-alikes', () => {
    const text = [
      'Closes #9 and `#5`.',
      '```',
      'fix #6',
      '```',
      'color #fff, v1#2x, a&#39; and path/to#8',
      'real #10',
    ].join('\n')
    expect(extractRefs(text, SELF)).toEqual([
      { repo: 'path/to', number: 8 },
      { repo: 'acme/widgets', number: 10 },
    ])
  })

  it('finds nothing in text without references', () => {
    expect(extractRefs('', SELF)).toEqual([])
    expect(extractRefs('no links here', SELF)).toEqual([])
  })
})

describe('dependencyRefs', () => {
  it('takes only the references on a line that makes them a precondition', () => {
    const text = [
      'Fixes #1.',
      'Depends on #12 and acme/lib#3.',
      'Blocked by https://github.com/other/svc/pull/7',
      'This is stacked on #20.',
      'See also #30 for background.',
    ].join('\n')
    expect(dependencyRefs(text, SELF)).toEqual([
      { repo: 'acme/widgets', number: 12 },
      { repo: 'acme/lib', number: 3 },
      { repo: 'other/svc', number: 7 },
      { repo: 'acme/widgets', number: 20 },
    ])
  })

  it('recognizes the other ways of saying it, in any case', () => {
    for (const line of [
      'REQUIRES #5',
      'waiting on #5',
      'Waiting for #5',
      'needs #5',
      'merge after #5',
      'land after #5',
      'based on #5',
      'builds on #5',
      'build on #5',
      'depend on #5',
      'dependent on #5',
    ]) {
      expect(dependencyRefs(line, SELF)).toEqual([{ repo: 'acme/widgets', number: 5 }])
    }
  })

  it('ignores a keyword inside code, a self reference, and a line without a reference', () => {
    expect(dependencyRefs('`depends on #5`', SELF)).toEqual([])
    expect(dependencyRefs('depends on #9', SELF)).toEqual([])
    expect(dependencyRefs('depends on nothing', SELF)).toEqual([])
    expect(dependencyRefs('afterwards see #5', SELF)).toEqual([])
  })

  it('ignores a keyword that does not lead up to the reference', () => {
    expect(dependencyRefs('Refs #5: the retained jobs require handlers.', SELF)).toEqual([])
    expect(dependencyRefs('This requires care. See #5.', SELF)).toEqual([])
    expect(dependencyRefs(`Requires ${'much '.repeat(20)}thought, see #5`, SELF)).toEqual([])
    expect(dependencyRefs('Tracked in #4; depends on #5.', SELF)).toEqual([
      { repo: 'acme/widgets', number: 5 },
    ])
  })
})

describe('names', () => {
  it('names a local reference by number and another repository in full', () => {
    expect(refKey({ repo: 'a/b', number: 3 })).toBe('a/b#3')
    expect(refName({ repo: 'a/b', number: 3 }, 'a/b')).toBe('#3')
    expect(refName({ repo: 'c/d', number: 3 }, 'a/b')).toBe('c/d#3')
  })
})
