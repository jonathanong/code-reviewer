import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { listShare, splitSections, stripFrontmatter } from './skill-text.mts'

const read = (name: string) =>
  readFileSync(new URL(`./fixtures/plugin/skills/${name}/SKILL.md`, import.meta.url), 'utf8')

describe('stripFrontmatter', () => {
  it('drops the frontmatter and keeps the body', () => {
    expect(stripFrontmatter('---\nname: a\n---\n# Body\n')).toBe('# Body\n')
  })

  it('leaves text without frontmatter, or with an unclosed one, alone', () => {
    expect(stripFrontmatter('# Body')).toBe('# Body')
    expect(stripFrontmatter('---\nname: a\n')).toBe('---\nname: a\n')
  })

  it('returns nothing for a file that is only frontmatter', () => {
    expect(stripFrontmatter('---\nname: a\n---')).toBe('')
  })
})

describe('listShare', () => {
  it('is high for a list of rules and low for prose', () => {
    expect(listShare(stripFrontmatter(read('rules-skill')))).toBeGreaterThan(0.85)
    expect(listShare(stripFrontmatter(read('prose-skill')))).toBeLessThan(0.5)
  })

  it('counts continuation lines as list lines and ignores headings, fences and blanks', () => {
    expect(listShare('# T\n\n- a\n  more\n\n```\nprose\n```\n')).toBe(1)
  })

  it('ends an item at the first unindented line', () => {
    expect(listShare('- a\nprose\n')).toBe(0.5)
  })

  it('is zero for an empty body', () => {
    expect(listShare('')).toBe(0)
  })
})

describe('splitSections', () => {
  it('splits on level-two headings outside fences and keeps the introduction', () => {
    const sections = splitSections(stripFrontmatter(read('rules-skill')))
    expect(sections.map((section) => section.heading)).toEqual([
      '(introduction)',
      'Widgets',
      'Gadgets',
      'Doodads',
    ])
    expect(sections[2]!.text).toContain('## not a heading, inside a fence')
  })

  it('drops an empty introduction', () => {
    expect(splitSections('## A\n- x\n').map((section) => section.heading)).toEqual(['A'])
  })
})
