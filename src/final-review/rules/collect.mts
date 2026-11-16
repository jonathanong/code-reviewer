/** A staged skill: where it lives plus the frontmatter the index shows. */
export type SkillInfo = { path: string; name: string; description: string }

const INSTRUCTION_FILES = ['AGENTS.md', 'CLAUDE.md']
const SKILL_PATTERNS = [
  /^\.agents\/skills\/[^/]+\/SKILL\.md$/u,
  /^\.claude\/skills\/[^/]+\/SKILL\.md$/u,
  /^skills\/[^/]+\/SKILL\.md$/u,
  /^plugins\/[^/]+\/skills\/[^/]+\/SKILL\.md$/u,
]

/** AGENTS.md and CLAUDE.md at the root and in every ancestor directory of each changed path. */
export function instructionPaths(all: readonly string[], changed: readonly string[]): string[] {
  const present = new Set(all)
  const dirs = new Set([''])
  for (const path of changed) {
    const parts = path.split('/').slice(0, -1)
    parts.forEach((_part, index) => dirs.add(`${parts.slice(0, index + 1).join('/')}/`))
  }
  return [...dirs]
    .flatMap((dir) => INSTRUCTION_FILES.map((file) => `${dir}${file}`))
    .filter((path) => present.has(path))
    .sort()
}

/** SKILL.md files in the conventional skill locations. */
export function skillPaths(all: readonly string[]): string[] {
  return all.filter((path) => SKILL_PATTERNS.some((pattern) => pattern.test(path))).sort()
}

/** Markdown files at any depth under `references/` beside each of the given SKILL.md paths. */
export function referencePaths(all: readonly string[], skills: readonly string[]): string[] {
  const dirs = skills.map((path) => `${path.slice(0, -'SKILL.md'.length)}references/`)
  return all
    .filter((path) => path.endsWith('.md'))
    .filter((path) => dirs.some((dir) => path.startsWith(dir)))
    .sort()
}

function unquote(value: string): string {
  const text = value.trim()
  const quote = text[0]
  return (quote === '"' || quote === "'") && text.length >= 2 && text.endsWith(quote)
    ? text.slice(1, -1)
    : text
}

/** Reads `name:` and `description:` from YAML-ish frontmatter, quoted or not. */
export function parseFrontmatter(text: string): { name?: string; description?: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text)
  if (match === null) return {}
  const fields: { name?: string; description?: string } = {}
  for (const line of (match[1] as string).split(/\r?\n/u)) {
    const field = /^(name|description):\s*(.*)$/u.exec(line)
    if (field !== null) fields[field[1] as 'name' | 'description'] = unquote(field[2] as string)
  }
  return fields
}

/** Describes a SKILL.md; the name falls back to its directory. */
export function skillInfo(path: string, text: string): SkillInfo {
  const { name, description } = parseFrontmatter(text)
  const dir = path.split('/').at(-2) as string
  return {
    path,
    name: name === undefined || name === '' ? dir : name,
    description: (description ?? '').replace(/\s+/gu, ' ').trim(),
  }
}
