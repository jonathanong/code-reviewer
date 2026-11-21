import { describe, expect, it } from 'vitest'

import { excerptsLines } from './excerpts-prompt.mts'
import { buildPillarRunPrompt, contextLines } from './pillar-prompt.mts'

const RUN = { out: '/run/out', sinceSha: null, hasRules: true }
const FILE = '/run/out/review-context.md'
const input = { contract: 'C', pillarText: 'P', run: RUN, skills: ['skills:a'], contextFile: FILE }

describe('excerptsLines', () => {
  it('adds nothing unless the mode is replace', () => {
    expect(excerptsLines(undefined, FILE)).toEqual([])
    expect(excerptsLines('alongside', FILE)).toEqual([])
  })

  it('tells the pillar not to load a skill quoted in full, overriding the earlier load lines', () => {
    const text = excerptsLines('replace', FILE).join('\n')
    expect(text).toContain(FILE)
    expect(text).toContain('already in front of you: do not load it')
    expect(text).toContain('overrides every earlier instruction to load')
    expect(text).toContain('only when it is not quoted or quoted in part')
  })
})

describe('the replace arm in a real review prompt', () => {
  it('leaves the default and alongside prompts byte-identical', () => {
    const plain = buildPillarRunPrompt(input)
    expect(buildPillarRunPrompt({ ...input, excerpts: 'alongside' })).toBe(plain)
    expect(plain).toContain('The excerpts are alongside the Skill loads, not instead of them.')
  })

  it('swaps the alongside sentence and ends with the block after the skill instruction', () => {
    const prompt = buildPillarRunPrompt({ ...input, excerpts: 'replace' })
    expect(prompt).not.toContain('alongside the Skill loads')
    expect(prompt.indexOf('Before reading any file')).toBeLessThan(
      prompt.indexOf('## Quoted rules replace loading'),
    )
    expect(prompt.endsWith(excerptsLines('replace', FILE).at(-1) as string)).toBe(true)
  })

  it('adds no block without a context file', () => {
    const { contextFile: _file, ...bare } = input
    expect(buildPillarRunPrompt({ ...bare, excerpts: 'replace' })).toBe(buildPillarRunPrompt(bare))
    expect(contextLines(undefined, 'replace')).toEqual([])
  })
})
