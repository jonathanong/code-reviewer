import { REPO_RE, isRecord, unknownKeys, type Json } from './settings-parse.mts'

/** Where a source's guide lives: a file in another repository's clone, or a file on this machine. */
export type EvidenceGuide = { repo: string; path: string } | { file: string }

/** A place the reviewer may read real data from, and the only commands it may run to do so. */
export type EvidenceSource = {
  name: string
  description: string
  guide: EvidenceGuide
  /** Command prefixes of at least two words; each becomes one `Bash(<prefix>:*)` allow rule. */
  commands: string[]
  /** Set in the environment of the evidence run only; never printed. */
  env: Record<string, string>
}

const SOURCE_KEYS = ['name', 'description', 'guide', 'commands', 'env']
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u
const WORD = '[A-Za-z0-9._/-]+'
const COMMAND_RE = new RegExp(`^${WORD}(?: ${WORD})+$`, 'u')
const ENV_NAME_RE = /^[A-Z_][A-Z0-9_]*$/u
const MAX_DESCRIPTION = 300

function guide(raw: unknown): EvidenceGuide | string {
  if (!isRecord(raw)) return '"guide" must be an object'
  const keys = Object.keys(raw)
  if (keys.length === 1 && keys[0] === 'file') {
    const file = raw.file
    // Absolute or home-relative, so the file never depends on the directory the reviewer ran in.
    const valid = typeof file === 'string' && /^(?:~\/|\/)[^\0]+$/u.test(file)
    return valid ? { file } : '"guide.file" must be an absolute path or start with ~/'
  }
  const { repo, path } = raw
  const only = keys.length === 2 && keys.includes('repo') && keys.includes('path')
  if (!only) return '"guide" must be exactly { "repo", "path" } or { "file" }'
  if (typeof repo !== 'string' || !REPO_RE.test(repo)) return '"guide.repo" must be owner/name'
  const relative = typeof path === 'string' && /^[^/\0][^\0]*$/u.test(path)
  if (!relative || path.split('/').includes('..')) {
    return '"guide.path" must be a relative path without ".."'
  }
  return { repo: repo.toLowerCase(), path }
}

function commands(raw: unknown): string[] | string {
  const list: unknown[] = Array.isArray(raw) ? raw : []
  if (list.length === 0) return '"commands" must be a non-empty array of command prefixes'
  const valid = list.filter((entry) => typeof entry === 'string' && COMMAND_RE.test(entry))
  if (valid.length !== list.length) {
    return 'every command must be two or more words of letters, digits and . _ / -, separated by single spaces'
  }
  return [...new Set(valid as string[])]
}

function envOf(raw: unknown): Record<string, string> | string {
  if (raw === undefined) return {}
  if (!isRecord(raw)) return '"env" must be an object of strings'
  const env: Record<string, string> = {}
  for (const [name, value] of Object.entries(raw)) {
    if (!ENV_NAME_RE.test(name)) return `"env" name "${name}" must match [A-Z_][A-Z0-9_]*`
    if (typeof value !== 'string' || value.includes('\0')) {
      return `"env" value for ${name} must be a string`
    }
    env[name] = value
  }
  return env
}

/** One source, or the reason it is dropped. Reasons never contain an `env` value. */
function source(raw: Json): EvidenceSource | string {
  const { name, description } = raw
  if (typeof name !== 'string' || !NAME_RE.test(name)) return '"name" must be a simple identifier'
  const oneLine = typeof description === 'string' ? description.replace(/\s+/gu, ' ').trim() : ''
  if (oneLine === '' || oneLine.length > MAX_DESCRIPTION) {
    return `"description" must be one line of at most ${MAX_DESCRIPTION} characters`
  }
  const found = guide(raw.guide)
  if (typeof found === 'string') return found
  const run = commands(raw.commands)
  if (typeof run === 'string') return run
  const env = envOf(raw.env)
  if (typeof env === 'string') return env
  return { name, description: oneLine, guide: found, commands: run, env }
}

/**
 * Parses an `evidence` list. A bad source is dropped with a problem and the rest stay; a list in
 * which every source is bad is ignored as a whole, so a typo falls back to the layer below instead
 * of switching evidence off.
 */
export function parseEvidence(
  raw: unknown,
  where: string,
  problems: string[],
): EvidenceSource[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be an array; ignored`)
    return undefined
  }
  const sources: EvidenceSource[] = []
  raw.forEach((item: unknown, index) => {
    const here = `${where}[${index}]`
    if (!isRecord(item)) {
      problems.push(`${here}: must be an object; source ignored`)
      return
    }
    problems.push(...unknownKeys(item, SOURCE_KEYS, here))
    const parsed = source(item)
    if (typeof parsed === 'string') {
      problems.push(`${here}: ${parsed}; source ignored`)
    } else if (sources.some((known) => known.name.toLowerCase() === parsed.name.toLowerCase())) {
      problems.push(`${here}: name "${parsed.name}" is already used; source ignored`)
    } else {
      sources.push(parsed)
    }
  })
  return sources.length === 0 && raw.length > 0 ? undefined : sources
}
