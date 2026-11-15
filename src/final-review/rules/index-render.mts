import type { SkillInfo } from './collect.mts'

/** Staged files of one source; paths are relative to `rules/`. */
export type Staged = { instructions: string[]; skills: SkillInfo[]; references: string[] }

type Linked = { heading: string; label: string; code: string; staged: Staged }

export type IndexInput = {
  repo?: { label: string; staged: Staged }
  shared: { name: string; label: string; staged: Staged }[]
  deps: Linked[]
  /** Repositories that consume what this change touches; their rules do not govern this diff. */
  consumers: Linked[]
  /** Suggested skill name to the first changed path that suggested it. */
  suggested: ReadonlyMap<string, string>
  missing: string[]
}

const MAX_DESCRIPTION = 200
const CONSUMERS_NOTE =
  'These repositories declare that they depend on what this change touches. Check their code for breakage; their rules explain their code and do not govern this diff.'

function truncate(text: string): string {
  return text.length <= MAX_DESCRIPTION ? text : `${text.slice(0, MAX_DESCRIPTION - 3)}...`
}

function skillLine(skill: SkillInfo, where?: string): string {
  const description = skill.description === '' ? '' : ` — ${truncate(skill.description)}`
  return `- ${skill.path}: ${skill.name}${description}${where === undefined ? '' : ` (${where})`}`
}

function list(title: string, lines: string[]): string[] {
  return lines.length === 0 ? [] : [`${title}:`, ...lines]
}

function bullets(paths: string[]): string[] {
  return paths.map((path) => `- ${path}`)
}

function body(staged: Staged, suggested?: ReadonlyMap<string, string>): string[] {
  const hit = (skill: SkillInfo) => suggested?.has(skill.name) === true
  const lines = (skills: SkillInfo[]) =>
    skills.map((skill) => skillLine(skill, suggested?.get(skill.name)))
  const skills =
    suggested === undefined
      ? list('Skills', lines(staged.skills))
      : [
          ...list('Suggested for this change', lines(staged.skills.filter(hit))),
          ...list('Other', lines(staged.skills.filter((skill) => !hit(skill)))),
        ]
  return [
    ...list('Instructions', bullets(staged.instructions)),
    ...skills,
    ...list('References', bullets(staged.references)),
  ]
}

function section(title: string, blocks: string[][]): string[] {
  return blocks.length === 0 ? [] : [title, '', ...blocks.flatMap((block) => [...block, ''])]
}

/** Renders `rules/INDEX.md`; empty sections are omitted. */
export function renderIndex(input: IndexInput): string {
  const repo =
    input.repo === undefined
      ? []
      : section(`## This repository (${input.repo.label})`, [body(input.repo.staged)])
  const shared = section(
    '## Shared skills',
    input.shared.map((source) => [
      `### ${source.name} (${source.label})`,
      ...body(source.staged, input.suggested),
    ]),
  )
  const linked = (items: Linked[]) =>
    items.map((dep) => [
      `### ${dep.heading} (${dep.label})`,
      `Code: ${dep.code}`,
      ...body(dep.staged),
    ])
  const deps = section('## Dependencies', linked(input.deps))
  const consumers = section(
    '## Consumers',
    input.consumers.length === 0 ? [] : [[CONSUMERS_NOTE], ...linked(input.consumers)],
  )
  const missing = section('## Missing', input.missing.length === 0 ? [] : [bullets(input.missing)])
  return [
    '# Rule sources',
    '',
    'Paths are relative to this file. Read the instructions that apply and the suggested skills; open other skills only when their description matches the change.',
    '',
    ...repo,
    ...shared,
    ...deps,
    ...consumers,
    ...missing,
  ]
    .join('\n')
    .replace(/\n+$/u, '\n')
}
