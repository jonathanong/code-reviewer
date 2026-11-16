import { describe, expect, it } from 'vitest'

import { SHARED_SOURCES, sharedPaths, type SharedSource } from './shared.mts'

const [noMistakes, skills] = SHARED_SOURCES as [SharedSource, SharedSource]

describe('sharedPaths', () => {
  it('takes the no-mistakes-rules AGENTS.md, flat skills, and their references', () => {
    const all = [
      'plugins/no-mistakes-rules/AGENTS.md',
      'plugins/no-mistakes-rules/skills/typescript-rules/SKILL.md',
      'plugins/no-mistakes-rules/skills/typescript-rules/references/x.md',
      'plugins/no-mistakes-rules/CLAUDE.md',
      'plugins/no-mistakes-rules/a/skills/y/SKILL.md',
      'plugins/other/skills/y/SKILL.md',
      'AGENTS.md',
    ]
    expect(sharedPaths(noMistakes, all)).toEqual([
      'plugins/no-mistakes-rules/AGENTS.md',
      'plugins/no-mistakes-rules/skills/typescript-rules/SKILL.md',
      'plugins/no-mistakes-rules/skills/typescript-rules/references/x.md',
    ])
  })

  it('takes every root skill of the skills repository, without its own instructions or evals', () => {
    const all = [
      'AGENTS.md',
      'README.md',
      'evals/test-authoring/case/prompt.md',
      'plugins/x/skills/y/SKILL.md',
      'skills/bounded-iteration/SKILL.md',
      'skills/bounded-iteration/references/sweep-patterns.md',
      'skills/test-authoring/SKILL.md',
      'skills/test-authoring/nested/SKILL.md',
    ]
    expect(sharedPaths(skills, all)).toEqual([
      'skills/bounded-iteration/SKILL.md',
      'skills/bounded-iteration/references/sweep-patterns.md',
      'skills/test-authoring/SKILL.md',
    ])
  })

  it('names the two sources and their clone directories', () => {
    expect(SHARED_SOURCES.map((source) => [source.name, source.cloneDir])).toEqual([
      ['no-mistakes-rules', 'no-mistakes'],
      ['skills', 'skills'],
    ])
  })
})
