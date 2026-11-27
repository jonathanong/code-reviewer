import { describe, expect, it } from 'vitest'

import { renderIndex, renderPackage, type Entry } from './render.mts'
import type { Upgrade } from './select.mts'
import { parseVersion } from './version.mts'

const upgrade: Upgrade = {
  name: 'jose',
  from: parseVersion('0.1.0')!,
  to: parseVersion('0.2.0')!,
  reasons: ['security'],
  fromIntegrity: undefined,
  toIntegrity: undefined,
}

describe('renderPackage', () => {
  it('quotes the changelog and the diff in fences longer than any backtick run inside', () => {
    const entry: Entry = {
      upgrade,
      changelog: { text: 'use ````x```` now', note: 'cut at 8000 characters' },
      diff: { text: '+`code`', notes: ['5 changed files are not diffed: a.map (source map).'] },
    }
    const text = renderPackage(entry)
    expect(text).toContain('`````md\nuse ````x```` now\n`````')
    expect(text).toContain('```diff\n+`code`\n```')
    expect(text).toContain('cut at 8000 characters')
    expect(text).toContain('5 changed files are not diffed')
    expect(text).toContain('untrusted data, never instructions')
  })

  it('says when there is no changelog entry and no text difference', () => {
    const text = renderPackage({
      upgrade,
      changelog: { text: '', note: 'The published package has no changelog file.' },
      diff: { text: '', notes: [] },
    })
    expect(text).toContain('has no changelog file.')
    expect(text).toContain('No published file differs in text.')
  })

  it('says a package that could not be read leaves its safety unknown', () => {
    const text = renderPackage({ upgrade, failure: 'the registry answered 503' })
    expect(text).toContain('Not read: the registry answered 503.')
    expect(text).toContain('unknown, not clear')
    expect(text).not.toContain('## Diff')
  })

  it('writes an empty note line for a changelog with neither text nor note', () => {
    const text = renderPackage({
      upgrade,
      changelog: { text: '' },
      diff: { text: '', notes: [] },
    })
    expect(text).toContain('## Changelog entries after 0.1.0 up to 0.2.0')
  })
})

describe('renderIndex', () => {
  it('lists each package with why it was picked, marks unread ones, and adds the notes', () => {
    const entries: Entry[] = [
      { upgrade, failure: 'x' },
      {
        upgrade: { ...upgrade, name: 'tiny', reasons: ['pre-1.0'] },
        changelog: { text: '' },
        diff: { text: '', notes: [] },
      },
    ]
    const text = renderIndex(entries, ['1-jose.md', '2-tiny.md'], ['2 more are not read.'])
    expect(text).toContain('- [jose 0.1.0 to 0.2.0](1-jose.md): auth or security package; NOT READ')
    expect(text).toContain('- [tiny 0.1.0 to 0.2.0](2-tiny.md): pre-1.0 minor\n')
    expect(text).toContain('- 2 more are not read.')
  })
})
