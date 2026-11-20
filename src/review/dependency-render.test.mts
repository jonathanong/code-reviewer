import { describe, expect, it } from 'vitest'

import type { Dependency } from './dependency.mts'
import { dependencyLine, dependsOnSection } from './dependency-render.mts'

const dep = (on: string, state: Dependency['state']): Dependency => ({
  on,
  kind: 'pull',
  state,
  why: `why ${on}`,
})

describe('dependsOnSection', () => {
  it('is empty without dependencies and when every one has merged', () => {
    expect(dependsOnSection(undefined)).toEqual([])
    expect(dependsOnSection([])).toEqual([])
    expect(dependsOnSection([dep('#1', 'merged')])).toEqual([])
  })

  it('lists what has not landed, with its state, and leaves out what has', () => {
    expect(
      dependsOnSection([
        dep('#1', 'merged'),
        dep('#2', 'open'),
        dep('#3', 'unknown'),
        dep('#4', 'closed'),
      ]),
    ).toEqual([
      '**Depends on**\n\n- #2 (open): why #2\n- #3 (unknown): why #3\n- #4 (closed): why #4',
    ])
  })

  it('caps the posted list and each reason, so the body stays under its length target', () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      ...dep(`#${i + 1}`, 'open'),
      why: 'x'.repeat(400),
    }))
    const block = dependsOnSection(many)[0] ?? ''
    const lines = block.split('\n').slice(2)
    expect(lines).toHaveLength(6)
    expect(lines[5]).toBe('- +10 more, listed in the full report')
    expect(block.length).toBeLessThan(1100)
  })

  it('writes one line per dependency for the report and the explanation', () => {
    expect(dependencyLine(dep('#2', 'open'))).toBe('- #2 (open): why #2')
  })
})
