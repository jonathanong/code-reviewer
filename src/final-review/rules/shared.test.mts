import { describe, expect, it } from 'vitest'

import { SHARED_SOURCES, TOOLING_ALLOW, sharedPaths, type SharedSource } from './shared.mts'

const [noMistakes, tooling] = SHARED_SOURCES as [SharedSource, SharedSource]

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

  it('applies the vouchington-tooling allowlist and adds allowed skills’ references', () => {
    const review = 'plugins/vouchington-workflow/skills/agent-workflow/references/review.md'
    const all = [
      'plugins/vouchington-testing/skills/test-authoring/SKILL.md',
      'plugins/vouchington-database/skills/glide-mq/SKILL.md',
      'plugins/vouchington-workflow/skills/agent-workflow/SKILL.md',
      'plugins/vouchington-workflow/skills/review-ci-logs/SKILL.md',
      'plugins/vouchington-workflow/skills/planning/SKILL.md',
      'plugins/unlisted/skills/x/SKILL.md',
      'plugins/vouchington-workflow/skills/agent-workflow/references/other.md',
      'plugins/vouchington-workflow/skills/planning/references/skipped.md',
      'plugins/skills/x/SKILL.md',
      review,
    ]
    expect(sharedPaths(tooling, all)).toEqual([
      'plugins/vouchington-database/skills/glide-mq/SKILL.md',
      'plugins/vouchington-testing/skills/test-authoring/SKILL.md',
      'plugins/vouchington-workflow/skills/agent-workflow/SKILL.md',
      'plugins/vouchington-workflow/skills/agent-workflow/references/other.md',
      review,
      'plugins/vouchington-workflow/skills/review-ci-logs/SKILL.md',
    ])
  })

  it('exports the allowlist with review-ci-logs', () => {
    expect(TOOLING_ALLOW['vouchington-workflow']).toContain('review-ci-logs')
  })
})
