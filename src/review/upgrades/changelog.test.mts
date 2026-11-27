import { describe, expect, it } from 'vitest'

import { changelogBetween, MAX_CHANGELOG_CHARS } from './changelog.mts'
import type { PackageFiles } from './tarball.mts'
import { parseVersion } from './version.mts'

const [v071, v080] = [parseVersion('0.7.1')!, parseVersion('0.8.0')!]
const files = (name: string, text: string): PackageFiles => new Map([[name, Buffer.from(text)]])

const CHANGESETS = `# @atproto/oauth-types

## 0.8.0

### Minor Changes

- abc: Rename \`clientId\` to \`client_id\`

## 0.7.1

### Patch Changes

- def: fix

## 0.7.0

### Minor Changes

- old
`

describe('changelogBetween', () => {
  it('quotes the entries after the old version up to and including the new one', () => {
    const { text, note } = changelogBetween(files('CHANGELOG.md', CHANGESETS), v071, v080)
    expect(text).toBe('## 0.8.0\n\n### Minor Changes\n\n- abc: Rename `clientId` to `client_id`')
    expect(note).toBeUndefined()
  })

  it('reads bracketed, v-prefixed and bare version headings', () => {
    const text = '## [1.0.0] - 2024\nbreaking\n\nv0.9.0 (2023)\nfeature\n\n0.8.0\nolder\n'
    const entries = changelogBetween(files('History.md', text), v080, parseVersion('1.0.0')!)
    expect(entries.text).toBe('## [1.0.0] - 2024\nbreaking\n\nv0.9.0 (2023)\nfeature')
  })

  it('says so when the package has no changelog file', () => {
    const entries = changelogBetween(files('README.md', '# x'), v071, v080)
    expect(entries).toEqual({ text: '', note: 'The published package has no changelog file.' })
  })

  it('says so when no entry lies between the versions', () => {
    const entries = changelogBetween(files('CHANGELOG.md', '## 0.5.0\nold\n'), v071, v080)
    expect(entries.text).toBe('')
    expect(entries.note).toContain('no entry between 0.7.1 and 0.8.0')
  })

  it('cuts long entries at a line and states the cut', () => {
    const body = `## 0.8.0\n${'a line of notes\n'.repeat(1000)}`
    const entries = changelogBetween(files('CHANGELOG.md', body), v071, v080)
    expect(entries.text.length).toBeLessThanOrEqual(MAX_CHANGELOG_CHARS)
    expect(entries.text.endsWith('a line of notes')).toBe(true)
    expect(entries.note).toContain('cut at')
  })
})
