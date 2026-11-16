import { describe, expect, it } from 'vitest'

import { buildPillarRunPrompt, runFileLines, skillInstruction } from './pillar-prompt.mts'

const RUN = { out: '/run/out', sinceSha: null, hasRules: true }

describe('runFileLines', () => {
  it('gives absolute paths to the index, context, and rules', () => {
    const lines = runFileLines(RUN).join('\n')
    expect(lines).toContain('`/run/out/diff/INDEX.md`')
    expect(lines).toContain('`/run/out/context.md`')
    expect(lines).toContain('`/run/out/rules/INDEX.md`')
    expect(lines).not.toContain('since')
  })

  it('lists the since index for a follow-up and omits the rules index when none was staged', () => {
    const lines = runFileLines({ out: '/o', sinceSha: 'abc123', hasRules: false }).join('\n')
    expect(lines).toContain('`/o/since/INDEX.md`')
    expect(lines).toContain('abc123')
    expect(lines).not.toContain('rules/INDEX.md')
  })
})

describe('buildPillarRunPrompt', () => {
  const input = { contract: ' CONTRACT ', pillarText: ' PILLAR ', run: RUN }

  it('orders the contract, the pillar, the run section, and ends with the skill instruction', () => {
    const prompt = buildPillarRunPrompt({ ...input, skills: ['skills:a', 'skills:b'] })
    expect(prompt.startsWith('CONTRACT\n\nPILLAR\n\n## This run')).toBe(true)
    expect(
      prompt.endsWith(
        'Before reading any file, call the Skill tool once for each of these skills, all in your first turn: skills:a, skills:b. They were selected for the files this pull request changes, so load every one, including any that looks unrelated to this pillar.',
      ),
    ).toBe(true)
  })

  it('adds no skill instruction when nothing was selected', () => {
    expect(skillInstruction([])).toEqual([])
    expect(buildPillarRunPrompt({ ...input, skills: [] })).not.toContain('Skill tool')
  })
})
