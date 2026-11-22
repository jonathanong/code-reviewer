import { describe, expect, it } from 'vitest'

import { onlyPathDiff } from './only-path.mts'

const A = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n'
const B = 'diff --git a/src/b.ts b/src/b.ts\n--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1 +1 @@\n-p\n+q\n'
const MOVED =
  'diff --git a/old/c.ts b/new/c.ts\nsimilarity index 90%\nrename from old/c.ts\nrename to new/c.ts\n--- a/old/c.ts\n+++ b/new/c.ts\n@@ -1 +1 @@\n-m\n+n\n'

describe('onlyPathDiff', () => {
  it('returns the diff untouched without paths', () => {
    expect(onlyPathDiff('c1', A + B, undefined)).toBe(A + B)
  })

  it('keeps only the files at the given paths, in order, ending in one newline', () => {
    expect(onlyPathDiff('c1', A + B + MOVED, ['src/b.ts'])).toBe(B)
    expect(onlyPathDiff('c1', A + B + MOVED, ['src/b.ts', 'src/a.ts'])).toBe(A + B)
  })

  it('matches a path written with a leading ./ or /', () => {
    expect(onlyPathDiff('c1', A + B, ['./src/a.ts'])).toBe(A)
    expect(onlyPathDiff('c1', A + B, ['/src/a.ts'])).toBe(A)
  })

  it('matches only the whole path, not a directory or a suffix', () => {
    expect(() => onlyPathDiff('c1', A + B, ['src'])).toThrow('case c1')
    expect(() => onlyPathDiff('c1', A + B, ['a.ts'])).toThrow('case c1')
  })

  it('matches a renamed file on its old or its new path', () => {
    expect(onlyPathDiff('c1', A + MOVED, ['old/c.ts'])).toBe(MOVED)
    expect(onlyPathDiff('c1', A + MOVED, ['new/c.ts'])).toBe(MOVED)
  })

  it('throws naming the case and every path when no file matches', () => {
    expect(() => onlyPathDiff('case-7', A, ['x.ts', 'y.ts'])).toThrow(
      'bench --only-path: case case-7 changes none of x.ts, y.ts.',
    )
  })
})
