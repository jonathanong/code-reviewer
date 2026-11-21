import { describe, expect, it } from 'vitest'

import { coverage, groupHunks, hunkSignature, normalizeLine } from './signature.mts'
import type { Hunk } from './types.mts'

const hunk = (path: string, removed: string[], added: string[]): Hunk => ({ path, removed, added })

describe('normalizeLine', () => {
  it('replaces identifiers, strings and numbers but keeps keywords and operators', () => {
    expect(normalizeLine('  let   total = count + 42 // "x"')).toBe('let ID = ID + NUM // STR')
    expect(normalizeLine("return call('a', `b ${c}`, 0x1F)")).toBe('return ID(STR, STR, NUM)')
  })

  it('keeps an operator change visible', () => {
    expect(normalizeLine('a == b')).not.toBe(normalizeLine('a === b'))
  })
})

describe('hunkSignature', () => {
  it('is equal for the same transformation on different names', () => {
    const a = hunkSignature(hunk('a.ts', ['let a = 1'], ['const a = 1']))
    const b = hunkSignature(hunk('b.ts', ['let bee = 22'], ['const bee = 22']))
    expect(a).toBe(b)
  })

  it('tells different transformations apart and caps long sides', () => {
    const one = hunkSignature(hunk('a.ts', ['let a = 1'], ['const a = 1']))
    const two = hunkSignature(hunk('a.ts', ['var a = 1'], ['const a = 1']))
    expect(one).not.toBe(two)
    const long = Array.from({ length: 12 }, () => 'x')
    expect(hunkSignature(hunk('a.ts', long, []))).toContain('+4 more')
  })
})

describe('groupHunks and coverage', () => {
  const hunks = [
    hunk('a.ts', ['let a = 1'], ['const a = 1']),
    hunk('a.ts', ['let b = 2'], ['const b = 2']),
    hunk('b.ts', ['let c = 3'], ['const c = 3']),
    hunk('c.ts', ['foo()'], ['bar()']),
    hunk('d.ts', ['x = 1'], []),
  ]

  it('counts hunks and distinct files, most hunks first, with the first hunk as example', () => {
    const groups = groupHunks(hunks)
    expect(groups.map((group) => [group.hunks, group.files])).toEqual([
      [3, 2],
      [1, 1],
      [1, 1],
    ])
    expect(groups[0]?.example).toBe(hunks[0])
  })

  it('reports the share the first groups cover as a whole percent', () => {
    const groups = groupHunks(hunks)
    expect(coverage(groups, 1, hunks.length)).toBe(60)
    expect(coverage(groups, 2, hunks.length)).toBe(80)
    expect(coverage([], 3, 0)).toBe(0)
  })
})
