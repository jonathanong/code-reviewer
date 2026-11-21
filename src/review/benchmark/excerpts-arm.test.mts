import { describe, expect, it } from 'vitest'

import { armOf, renderArms, summarizeLoads } from './excerpts-arm.mts'

describe('armOf', () => {
  it('is null when no run had the flag, the arm when they agree, mixed otherwise', () => {
    expect(armOf([null, null])).toBeNull()
    expect(armOf([null, 'replace', 'replace'])).toBe('replace')
    expect(armOf(['replace', 'alongside'])).toBe('mixed')
  })
})

describe('summarizeLoads', () => {
  it('averages over the runs that recorded their skills', () => {
    expect(summarizeLoads([2, null, 4])).toEqual({ runs: 2, total: 6, mean: 3 })
    expect(summarizeLoads([null])).toEqual({ runs: 0, total: 0, mean: null })
  })
})

describe('renderArms', () => {
  it('prints nothing for a run without the flag', () => {
    const arm = { excerpts: null, skillLoads: summarizeLoads([1]) }
    expect(renderArms([{ pillar: 'rules', arm }])).toEqual([])
  })

  it('prints one row per pillar with the arm and loads per run', () => {
    const rows = renderArms([
      { pillar: 'rules', arm: { excerpts: 'replace', skillLoads: summarizeLoads([1, 2]) } },
      { pillar: 'design', arm: { excerpts: 'replace', skillLoads: summarizeLoads([]) } },
      { pillar: 'history', arm: { excerpts: null, skillLoads: summarizeLoads([]) } },
    ]).join('\n')
    expect(rows).toContain('| rules | replace | 2 | 3 | 1.5 |')
    expect(rows).toContain('| design | replace | 0 | 0 | n/a |')
    expect(rows).toContain('| history | n/a | 0 | 0 | n/a |')
  })
})
