import { buildContext, sectionsNamed } from '../context/build.mts'
import { SKILL_QUOTE_CAP } from '../context/rule-excerpts.mts'
import { stripFrontmatter } from '../context/skill-text.mts'
import type { ContextSkill } from '../context/types.mts'
import type { Exec } from './exec.mts'
import type { ExpectedRule } from './expected-rules.mts'

/** How much of a skill the excerpts section quotes; `absent` is a skill that is not installed. */
export type SkillStatus = 'full' | 'part' | 'none' | 'absent'

/** `missing`: the text is not in the installed skill (version drift); `cut`: in it, not quoted. */
export type RuleOutcome = 'present' | 'cut' | 'missing' | 'absent'

export type SkillRow = { skill: string; status: SkillStatus; quotedChars: number }
export type RuleRow = { skill: string; text: string; outcome: RuleOutcome }

export type RulesCheck = {
  skills: SkillRow[]
  rules: RuleRow[]
  /** Characters of the rule-excerpts section body, 0 when it is empty. */
  sectionChars: number
  /** Characters one skill may have quoted at most. */
  cap: number
}

type Quoted = { status: SkillStatus; text: string }

const unquote = (line: string): string => (line.startsWith('> ') ? line.slice(2) : '')

function statusOf(line: string): SkillStatus {
  if (line === 'Status: quoted in full') return 'full'
  return line.startsWith('Status: quoted in part') ? 'part' : 'none'
}

/** Reads the section built with `excerpts: 'replace'`, whose skill blocks each carry a status. */
function readQuoted(body: string): Map<string, Quoted> {
  const found = new Map<string, Quoted>()
  let current: { name: string; status: SkillStatus; lines: string[] } | null = null
  const close = () => {
    if (current !== null)
      found.set(current.name, { status: current.status, text: current.lines.join('\n') })
  }
  for (const line of body.split('\n')) {
    if (line.startsWith('### ')) {
      close()
      current = { name: line.slice(4), status: 'none', lines: [] }
    } else if (current !== null && line.startsWith('Status: ')) current.status = statusOf(line)
    else if (current !== null && line.startsWith('>')) current.lines.push(unquote(line))
  }
  close()
  return found
}

function outcome(rule: ExpectedRule, quoted: Quoted | undefined, skillText: string): RuleOutcome {
  if (quoted === undefined) return 'absent'
  if (!skillText.includes(rule.text)) return 'missing'
  return quoted.text.includes(rule.text) ? 'present' : 'cut'
}

/**
 * Builds the rule-excerpts section for exactly `names` (no selection, no model) and checks what
 * it quotes: each skill's status and whether each expected rule is in the quoted text.
 */
export async function checkRules(
  names: readonly string[],
  rules: readonly ExpectedRule[],
  installed: readonly ContextSkill[],
  deps: { exec: Exec; readFile(path: string): string },
): Promise<RulesCheck> {
  const skills = installed.filter((skill) => names.includes(skill.name))
  const built = await buildContext(
    { repo: '', pr: 0, tree: '', baseSha: '', headSha: '', out: '', skills, excerpts: 'replace' },
    { exec: deps.exec, readFile: async (path) => deps.readFile(path) },
    sectionsNamed(['rule-excerpts']),
  )
  const body = built.sections[0]?.body ?? ''
  const quoted = readQuoted(body)
  const file = (name: string) => skills.find((skill) => skill.name === name)?.file
  return {
    skills: names.map((skill) => ({
      skill,
      status: quoted.get(skill)?.status ?? 'absent',
      quotedChars: quoted.get(skill)?.text.length ?? 0,
    })),
    rules: rules.map((rule) => {
      const path = file(rule.skill)
      const text = path === undefined ? '' : stripFrontmatter(deps.readFile(path))
      return { ...rule, outcome: outcome(rule, quoted.get(rule.skill), text) }
    }),
    sectionChars: body.length,
    cap: SKILL_QUOTE_CAP,
  }
}
