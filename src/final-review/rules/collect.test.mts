import { describe, expect, it } from 'vitest'

import { instructionPaths, parseFrontmatter, skillInfo, skillPaths } from './collect.mts'

describe('instructionPaths', () => {
  it('takes AGENTS.md and CLAUDE.md at the root and in each ancestor of a changed path', () => {
    const all = [
      'AGENTS.md',
      'CLAUDE.md',
      'src/AGENTS.md',
      'src/api/CLAUDE.md',
      'src/other/AGENTS.md',
      'docs/AGENTS.md',
      'src/api/x.ts',
    ]
    expect(instructionPaths(all, ['src/api/x.ts', 'src/api/y.ts'])).toEqual([
      'AGENTS.md',
      'CLAUDE.md',
      'src/AGENTS.md',
      'src/api/CLAUDE.md',
    ])
  })

  it('still reads the root files for a root-level change or no changes', () => {
    expect(instructionPaths(['AGENTS.md'], ['README.md'])).toEqual(['AGENTS.md'])
    expect(instructionPaths(['AGENTS.md', 'a/AGENTS.md'], [])).toEqual(['AGENTS.md'])
  })
})

describe('skillPaths', () => {
  it('matches only the conventional SKILL.md locations', () => {
    const all = [
      '.agents/skills/a/SKILL.md',
      '.claude/skills/b/SKILL.md',
      'skills/c/SKILL.md',
      'plugins/p/skills/d/SKILL.md',
      'skills/c/references/x.md',
      'skills/c/sub/SKILL.md',
      'other/skills/e/SKILL.md',
    ]
    expect(skillPaths(all)).toEqual([
      '.agents/skills/a/SKILL.md',
      '.claude/skills/b/SKILL.md',
      'plugins/p/skills/d/SKILL.md',
      'skills/c/SKILL.md',
    ])
  })
})

describe('parseFrontmatter', () => {
  it('reads quoted and unquoted fields', () => {
    expect(parseFrontmatter('---\nname: "a"\ndescription: \'It is b\'\nx: y\n---\nbody')).toEqual({
      name: 'a',
      description: 'It is b',
    })
    expect(parseFrontmatter('---\r\nname: plain\r\ndescription: Not "quoted\r\n---\r\n')).toEqual({
      name: 'plain',
      description: 'Not "quoted',
    })
  })

  it('returns nothing without frontmatter and keeps a lone quote', () => {
    expect(parseFrontmatter('no frontmatter')).toEqual({})
    expect(parseFrontmatter('---\nname: "\n---')).toEqual({ name: '"' })
  })
})

describe('skillInfo', () => {
  it('falls back to the directory name and flattens the description', () => {
    expect(skillInfo('skills/dir/SKILL.md', '---\ndescription: a   b\n---')).toEqual({
      path: 'skills/dir/SKILL.md',
      name: 'dir',
      description: 'a b',
    })
    expect(skillInfo('skills/dir/SKILL.md', 'nothing').description).toBe('')
    expect(skillInfo('skills/dir/SKILL.md', '---\nname: n\n---').name).toBe('n')
    expect(skillInfo('skills/dir/SKILL.md', '---\nname:\n---').name).toBe('dir')
  })
})
