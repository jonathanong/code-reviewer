import { describe, expect, it } from 'vitest'

import { baseIsDead, type CarriedFile } from './carried-file.mts'
import { carriedNotes, homeName, plain } from './carried-note.mts'
import { notesSection } from './notes.mts'

const FILE: CarriedFile = {
  commits: [],
  commitsInRange: 3,
  files: [],
  filesTotal: 0,
  defaultBranch: 'main',
  base: 'present',
  problems: [],
  baseRef: 'feat/parent',
}
const commit = (sha: string, home: CarriedFile['commits'][number]['home']) => ({
  sha: sha.repeat(40),
  subject: 's',
  home,
  how: 'patch' as const,
})

describe('plain and homeName', () => {
  it('makes an untrusted name one short line without backticks', () => {
    expect(plain('a `b`\n\tc')).toBe('a b c')
    expect(plain('x'.repeat(300))).toHaveLength(100)
  })

  it('names a pull request by number and the default branch by its name', () => {
    expect(homeName({ kind: 'pull', number: 4 }, 'main')).toBe('#4')
    expect(homeName({ kind: 'default' }, 'main')).toBe('`main`')
    expect(homeName({ kind: 'default' }, null)).toBe('`the default branch`')
  })
})

describe('baseIsDead', () => {
  it('is true for a missing base or one a pull request merged, false otherwise', () => {
    expect(baseIsDead({ ...FILE, base: 'missing' })).toBe(true)
    expect(baseIsDead({ ...FILE, baseMergedIn: 3 })).toBe(true)
    expect(baseIsDead(FILE)).toBe(false)
    expect(baseIsDead({ ...FILE, base: 'unknown' })).toBe(false)
  })
})

describe('carriedNotes', () => {
  it('says nothing when nothing is carried and the base is alive', () => {
    expect(carriedNotes(FILE)).toEqual([])
  })

  it('tells the author once to retarget when the base was merged or deleted', () => {
    expect(carriedNotes({ ...FILE, baseMergedIn: 3 })).toEqual([
      "Base branch `feat/parent` was merged in #3, so this diff may include changes that are not this pull request's own; retarget it to `main`.",
    ])
    expect(carriedNotes({ ...FILE, base: 'missing' })[0]).toContain(
      'Base branch `feat/parent` no longer exists',
    )
  })

  it('falls back to generic names without a base ref or default branch', () => {
    const [note] = carriedNotes({ ...FILE, base: 'missing', baseRef: null, defaultBranch: null })
    expect(note).toContain('Base branch the base branch no longer exists')
    expect(note).toContain('retarget it to the default branch.')
  })

  it('counts the carried commits with where they already are, short shas, and the overflow', () => {
    const commits = ['1', '2', '3', '4', '5', '6', '7'].map((digit, at) =>
      commit(digit, at === 0 ? { kind: 'pull', number: 9 } : { kind: 'default' }),
    )
    const [note] = carriedNotes({ ...FILE, commits, commitsInRange: 8 })
    expect(note).toContain('7 of 8 commits')
    expect(note).toContain('already exist in #9, `main`')
    expect(note).toContain('`1111111`')
    expect(note).toContain('and 2 more.')
    expect(note).not.toContain('`6666666`')
  })

  it('gives both notes when the base is dead and commits are carried', () => {
    const notes = carriedNotes({
      ...FILE,
      base: 'missing',
      commits: [commit('a', { kind: 'default' })],
    })
    expect(notes).toHaveLength(2)
    expect(notes[1]).not.toContain('more.')
  })
})

describe('notesSection', () => {
  it('is empty without notes, so the review body does not change', () => {
    expect(notesSection(undefined)).toEqual([])
    expect(notesSection([])).toEqual([])
  })

  it('lists each note under one heading', () => {
    expect(notesSection(['one', 'two'])).toEqual(['**Notes**\n\n- one\n- two'])
  })
})
