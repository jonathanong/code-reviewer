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

  it('accepts CRLF frontmatter and keeps the body', () => {
    expect(stripFrontmatter('---\r\nname: a\r\n---\r\n- rule\r\n')).toBe('- rule\r\n')
  })

  it('accepts an empty frontmatter', () => {
    expect(stripFrontmatter('---\n---\nbody')).toBe('body')
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

  it('counts numbered items with either delimiter', () => {
    expect(listShare('1) MUST keep identity.\n2) MUST release resources.\n3. MUST log.\n')).toBe(1)
  })

  it('is not closed by a shorter or different fence inside a block', () => {
    const body = '- a\n````\nprose\n```\nmore prose\n~~~~\n````\n- b\n'
    expect(listShare(body)).toBe(1)
  })

  it('does not open a code block on a backtick fence whose info string has a backtick', () => {
    expect(listShare('``` a`b\nprose\n')).toBe(0)
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

  it('does not split on a heading inside a longer fence closed by a shorter line', () => {
    const body = '## A\n````\n```\n## inside\n````\n## B\n- x\n'
    expect(splitSections(body).map((section) => section.heading)).toEqual(['A', 'B'])
  })

  it('keeps the whitespace of nonblank lines and drops only blank lines at the ends', () => {
    const sections = splitSections('\n  - indented item\n- last   \n\n## B\n\n- b  \n\n')
    expect(sections.map((section) => section.text)).toEqual([
      '  - indented item\n- last   ',
      '## B\n\n- b  ',
    ])
  })

  it('drops an empty introduction', () => {
    expect(splitSections('## A\n- x\n').map((section) => section.heading)).toEqual(['A'])
  })
})
