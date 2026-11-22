import { describe, expect, it } from 'vitest'

import { grantedOnlyPath, onlyPathNote, onlyPaths } from './only-path-option.mts'

describe('onlyPaths', () => {
  it('is undefined without the flag', () => {
    expect(onlyPaths({})).toBeUndefined()
  })

  it('normalizes the paths and drops duplicates', () => {
    expect(onlyPaths({ 'only-path': ['./a.ts', '/a.ts', 'b/c.ts'] })).toEqual(['a.ts', 'b/c.ts'])
  })

  it('refuses an empty path and --loads-only', () => {
    expect(() => onlyPaths({ 'only-path': ['a.ts', ' '] })).toThrow('bench --only-path needs')
    expect(() => onlyPaths({ 'only-path': ['a.ts'], 'loads-only': true })).toThrow(
      'bench --only-path cannot be used with --loads-only',
    )
  })
})

describe('grantedOnlyPath', () => {
  it('prefers the flag', () => {
    expect(grantedOnlyPath(['a.ts'], [['b.ts']])).toEqual(['a.ts'])
  })

  it('reads one arm from the saved results', () => {
    expect(grantedOnlyPath(undefined, [['a.ts'], ['a.ts']])).toEqual(['a.ts'])
  })

  it('is undefined when no saved result records paths', () => {
    expect(grantedOnlyPath(undefined, [null, null])).toBeUndefined()
    expect(grantedOnlyPath(undefined, [])).toBeUndefined()
  })

  it('refuses saved results that differ', () => {
    expect(() => grantedOnlyPath(undefined, [['a.ts'], null])).toThrow('not one arm')
  })
})

describe('onlyPathNote', () => {
  it('names the paths and says the rows are an experiment', () => {
    const note = onlyPathNote(['a.ts', 'b.ts'])
    expect(note).toContain('only a.ts, b.ts')
    expect(note).toContain('not comparable with normal rows')
  })
})
