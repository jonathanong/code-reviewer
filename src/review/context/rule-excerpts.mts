import { listShare, splitSections, stripFrontmatter } from './skill-text.mts'
import type { ContextSection, ContextSkill, SectionBuilder } from './types.mts'

/** A body with at least this share of list lines is quoted; measured on installed skills. */
export const LIST_SHARE_MIN = 0.85
/** Characters of one skill quoted at most; whole sections only. */
export const SKILL_QUOTE_CAP = 6000

const SEPARATOR = '\n\n'

const quote = (text: string): string =>
  text
    .split('\n')
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\n')

function describe(skill: ContextSkill): string[] {
  return [`### ${skill.name}`, `Full skill: ${skill.file}`, `Description: ${skill.description}`]
}

function excerpt(skill: ContextSkill, text: string): string {
  const body = stripFrontmatter(text)
  if (listShare(body) < LIST_SHARE_MIN) {
    return [...describe(skill), 'Not quoted: mostly prose. Read the full skill.'].join('\n')
  }
  const kept: string[] = []
  const dropped: string[] = []
  let used = 0
  for (const section of splitSections(body)) {
    // Sections are joined by a blank line, which counts against the cap too.
    const cost = section.text.length + (kept.length === 0 ? 0 : SEPARATOR.length)
    if (dropped.length === 0 && used + cost <= SKILL_QUOTE_CAP) {
      kept.push(section.text)
      used += cost
    } else dropped.push(section.heading)
  }
  const lines = describe(skill)
  if (kept.length > 0) lines.push('', quote(kept.join(SEPARATOR)))
  if (dropped.length > 0) {
    lines.push(
      '',
      `Sections not quoted (over the cap): ${dropped.join('; ')}. Read the full skill.`,
    )
  }
  return lines.join('\n')
}

/** The rule text of each selected skill, verbatim, when the skill is a list of rules. */
export const ruleExcerpts: SectionBuilder = {
  name: 'rule-excerpts',
  async build(input, deps): Promise<ContextSection | null> {
    if (input.skills.length === 0) return null
    const parts = await Promise.all(
      input.skills.map(async (skill) => excerpt(skill, await deps.readFile(skill.file))),
    )
    return { title: 'Rule excerpts', body: parts.join('\n\n') }
  },
}
