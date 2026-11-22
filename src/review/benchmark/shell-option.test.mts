import { describe, expect, it } from 'vitest'

import { grantedShell, shellNote, shellPrefixes } from './shell-option.mts'

describe('shellPrefixes', () => {
  it('grants nothing without the flag', () => {
    expect(shellPrefixes({})).toEqual([])
    expect(shellPrefixes({ harness: 'codex' })).toEqual([])
  })

  it('trims and de-duplicates, and accepts claude by name', () => {
    expect(shellPrefixes({ shell: [' git log', 'rg', 'git log'], harness: 'claude' })).toEqual([
      'git log',
      'rg',
    ])
  })

  it('rejects an empty prefix naming the flag', () => {
    expect(() => shellPrefixes({ shell: ['git log', '  '] })).toThrow('bench --shell needs')
  })

  it.each(['git log; rm x', 'git log | cat', 'a & b', 'x > y', 'x < y', 'x `y`', 'x $(y)', 'a\nb'])(
    'rejects shell syntax in %j',
    (prefix) => {
      expect(() => shellPrefixes({ shell: [prefix] })).toThrow('without shell syntax')
    },
  )

  it('rejects a non-Claude harness, saying it refuses shell prefixes', () => {
    expect(() => shellPrefixes({ shell: ['rg'], harness: 'codex' })).toThrow(
      'bench --shell needs --harness claude: the codex harness refuses shell prefixes',
    )
  })
})

describe('grantedShell', () => {
  it('prefers the flag, then the first saved result, else nothing', () => {
    expect(grantedShell(['rg'], [['git log']])).toEqual(['rg'])
    expect(grantedShell(undefined, [null, ['git log']])).toEqual(['git log'])
    expect(grantedShell(undefined, [null])).toBeUndefined()
    expect(grantedShell(undefined, [[]])).toBeUndefined()
  })
})

describe('shellNote', () => {
  it('lists the prefixes and says the rows are not comparable', () => {
    const note = shellNote(['git log', 'rg'])
    expect(note).toContain('Shell granted to the pillar agent: git log, rg.')
    expect(note).toContain('not comparable')
  })
})
