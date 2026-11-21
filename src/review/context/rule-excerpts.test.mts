import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { LIST_SHARE_MIN, SKILL_QUOTE_CAP, ruleExcerpts } from './rule-excerpts.mts'
import type { ContextDeps, ContextInput, ContextSkill } from './types.mts'

const fixture = (name: string) =>
  fileURLToPath(new URL(`./fixtures/plugin/skills/${name}/SKILL.md`, import.meta.url))

const rules: ContextSkill = {
  name: 'team:sample-rules',
  description: 'Rules for sample widgets.',
  file: fixture('rules-skill'),
}
const prose: ContextSkill = {
  name: 'team:sample-prose',
  description: 'How to think about sample gizmos.',
  file: fixture('prose-skill'),
}

const deps = (files: Record<string, string> = {}): ContextDeps => ({
  exec: async () => '',
  readFile: async (path) => files[path] ?? readFile(path, 'utf8'),
})

const input = (skills: ContextSkill[]): ContextInput => ({
  repo: 'o/r',
  pr: 1,
  tree: '/tree',
  baseSha: 'b',
  headSha: 'h',
  out: '/out',
  skills,
})

const quoted = (body: string) =>
  body
    .split('\n')
    .filter((line) => line.startsWith('>'))
    .map((line) => line.replace(/^> ?/u, ''))

describe('ruleExcerpts', () => {
  it('has nothing to say without skills', async () => {
    expect(await ruleExcerpts.build(input([]), deps())).toBeNull()
  })

  it('quotes a list-style skill verbatim with its name, description and file', async () => {
    const section = await ruleExcerpts.build(input([rules]), deps())
    expect(section!.title).toBe('Rule excerpts')
    const source = (await readFile(rules.file, 'utf8')).split('\n')
    const lines = quoted(section!.body)
    expect(lines).toContain('- MUST NOT paint a widget twice in one frame.')
    expect(lines).toContain('  use its identity instead.')
    for (const line of lines) expect(source).toContain(line)
    expect(section!.body).toContain('### team:sample-rules')
    expect(section!.body).toContain(`Full skill: ${rules.file}`)
    expect(section!.body).toContain('Description: Rules for sample widgets.')
    expect(section!.body).not.toContain('Sections not quoted')
  })

  it('does not quote a prose skill but still links it', async () => {
    const section = await ruleExcerpts.build(input([prose]), deps())
    expect(quoted(section!.body)).toEqual([])
    expect(section!.body).toContain(`Full skill: ${prose.file}`)
    expect(section!.body).toContain('Not quoted: mostly prose')
  })

  it('drops whole trailing sections over the cap and names them', async () => {
    const big = `- ${'x'.repeat(SKILL_QUOTE_CAP - 100)}`
    const text = `## First\n${big}\n\n## Second\n- ${'y'.repeat(200)}\n\n## Third\n- z\n`
    const section = await ruleExcerpts.build(input([rules]), deps({ [rules.file]: text }))
    const lines = quoted(section!.body)
    expect(lines).toContain('## First')
    expect(lines.join('\n')).not.toContain('yyy')
    expect(lines.join('\n')).not.toContain('- z')
    expect(section!.body).toContain('Sections not quoted (over the cap): Second; Third.')
  })

  it('counts the blank line between sections against the cap', async () => {
    const half = (name: string) => `## ${name}\n- ${'x'.repeat(SKILL_QUOTE_CAP / 2 - 7)}`
    const text = `${half('A')}\n\n${half('B')}\n`
    expect(half('A')).toHaveLength(SKILL_QUOTE_CAP / 2)
    const section = await ruleExcerpts.build(input([rules]), deps({ [rules.file]: text }))
    expect(quoted(section!.body).some((line) => line === '## A')).toBe(true)
    expect(quoted(section!.body).some((line) => line === '## B')).toBe(false)
    expect(section!.body).toContain('Sections not quoted (over the cap): B.')
  })

  it('quotes nothing when even the first section is over the cap', async () => {
    const text = `## Only\n- ${'x'.repeat(SKILL_QUOTE_CAP)}\n`
    const section = await ruleExcerpts.build(input([rules]), deps({ [rules.file]: text }))
    expect(quoted(section!.body)).toEqual([])
    expect(section!.body).toContain('Sections not quoted (over the cap): Only.')
  })

  it('marks nothing unless asked, so the default text has no status line', async () => {
    const section = await ruleExcerpts.build(input([rules, prose]), deps())
    expect(section!.body).not.toContain('Status:')
  })

  describe('in replace mode', () => {
    const replace = (skills: ContextSkill[]): ContextInput => ({
      ...input(skills),
      excerpts: 'replace',
    })

    it('marks a skill quoted in full and one that is not quoted', async () => {
      const section = await ruleExcerpts.build(replace([rules, prose]), deps())
      expect(section!.body).toContain('Status: quoted in full')
      expect(section!.body).toContain('Status: not quoted\nNot quoted: mostly prose')
    })

    it('marks a skill quoted in part with the sections dropped', async () => {
      const big = `- ${'x'.repeat(SKILL_QUOTE_CAP - 100)}`
      const text = `## First\n${big}\n\n## Second\n- ${'y'.repeat(200)}\n\n## Third\n- z\n`
      const section = await ruleExcerpts.build(replace([rules]), deps({ [rules.file]: text }))
      expect(section!.body).toContain('Status: quoted in part (sections dropped: Second; Third)')
    })

    it('marks a skill whose first section is over the cap as not quoted', async () => {
      const text = `## Only\n- ${'x'.repeat(SKILL_QUOTE_CAP)}\n`
      const section = await ruleExcerpts.build(replace([rules]), deps({ [rules.file]: text }))
      expect(section!.body).toContain('Status: not quoted\n\nSections not quoted')
    })

    it('keeps the quoted text the same as the default arm', async () => {
      const plain = await ruleExcerpts.build(input([rules]), deps())
      const marked = await ruleExcerpts.build(replace([rules]), deps())
      expect(marked!.body.replace('Status: quoted in full\n', '')).toBe(plain!.body)
    })
  })

  it('keeps the threshold between the two fixtures', () => {
    expect(LIST_SHARE_MIN).toBeGreaterThan(0.5)
    expect(LIST_SHARE_MIN).toBeLessThan(1)
  })
})
