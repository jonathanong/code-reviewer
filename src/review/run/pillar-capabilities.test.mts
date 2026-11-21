import { describe, expect, it } from 'vitest'

import { claudeTools } from '../../harness/claude-args.mts'
import { EFFORT } from '../../harness/types.mts'
import { SKILL_READER, pillarCapabilities } from './pillar-capabilities.mts'

const PILLAR_TOOLS = 'Read,Grep,Glob,Agent,Skill'
const PILLAR_TOOLS_NO_SKILLS = 'Read,Grep,Glob,Agent'
const SKILL_TOOLS = 'Read,Grep,Glob,Skill'

const toolFlags = (...args: Parameters<typeof pillarCapabilities>) =>
  claudeTools(pillarCapabilities(...args))

describe('tool sets', () => {
  it('keeps the verifier read-only and the control runs without a Skill tool', () => {
    expect(claudeTools(SKILL_READER).tools).toBe(SKILL_TOOLS)
    expect(toolFlags('design', false).tools).toBe(PILLAR_TOOLS_NO_SKILLS)
  })

  it('maps a light plan to low effort and a full plan to medium', () => {
    expect(EFFORT).toEqual({ light: 'low', full: 'medium' })
  })
})

describe('pillarCapabilities', () => {
  it('gives a non-history pillar the pillar tools, without Skill for a control run', () => {
    expect(toolFlags('design')).toEqual({ tools: PILLAR_TOOLS, allowedTools: PILLAR_TOOLS })
    expect(toolFlags('design', false)).toEqual({
      tools: PILLAR_TOOLS_NO_SKILLS,
      allowedTools: PILLAR_TOOLS_NO_SKILLS,
    })
  })

  it('is unchanged without domains, for every pillar', () => {
    expect(toolFlags('correctness')).toEqual({
      tools: PILLAR_TOOLS,
      allowedTools: PILLAR_TOOLS,
    })
    expect(toolFlags('correctness', true, [])).toEqual(toolFlags('correctness'))
    expect(claudeTools({ ...SKILL_READER, web: [] })).toEqual({
      tools: SKILL_TOOLS,
      allowedTools: SKILL_TOOLS,
    })
  })

  it('gives the security pillar the same WebFetch rules as correctness', () => {
    expect(toolFlags('security', true, ['a.example.com'])).toEqual(
      toolFlags('correctness', true, ['a.example.com']),
    )
    expect(toolFlags('security')).toEqual({ tools: PILLAR_TOOLS, allowedTools: PILLAR_TOOLS })
  })

  it('gives only the correctness and security pillars WebFetch, allowed per domain', () => {
    expect(toolFlags('correctness', true, ['a.example.com', 'b.example.com'])).toEqual({
      tools: `${PILLAR_TOOLS},WebFetch`,
      allowedTools: `${PILLAR_TOOLS},WebFetch(domain:a.example.com),WebFetch(domain:b.example.com)`,
    })
    expect(toolFlags('correctness', false, ['a.example.com']).tools).toBe(
      `${PILLAR_TOOLS_NO_SKILLS},WebFetch`,
    )
    for (const pillar of ['rules', 'design', 'history', 'blast-radius', 'congruence'] as const) {
      expect(toolFlags(pillar, true, ['a.example.com']).tools).not.toContain('WebFetch')
      expect(toolFlags(pillar, true, ['a.example.com']).allowedTools).not.toContain('WebFetch')
    }
  })

  it('never offers WebFetch without a domain rule, and lists each domain once', () => {
    const flags = claudeTools({ ...SKILL_READER, web: ['a.example.com', 'a.example.com'] })
    expect(flags.allowedTools).toBe(`${SKILL_TOOLS},WebFetch(domain:a.example.com)`)
    expect(flags.allowedTools.split(',')).not.toContain('WebFetch')
  })

  it('limits the history pillar shell to git log and git show', () => {
    expect(toolFlags('history')).toEqual({
      tools: `${PILLAR_TOOLS},Bash`,
      allowedTools: `${PILLAR_TOOLS},Bash(git log:*),Bash(git show:*)`,
    })
    expect(toolFlags('history', false)).toEqual({
      tools: `${PILLAR_TOOLS_NO_SKILLS},Bash`,
      allowedTools: `${PILLAR_TOOLS_NO_SKILLS},Bash(git log:*),Bash(git show:*)`,
    })
  })
})
