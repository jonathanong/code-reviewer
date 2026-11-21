import { parseCommands, parseGuide, type EvidenceGuide } from './evidence-parse.mts'
import { isRecord, unknownKeys, type Json } from './settings-parse.mts'

/** Where a tool's guide lives: inline text, or a file the way an evidence guide is. */
export type AnalysisGuide = EvidenceGuide | { text: string }

/** A read-only code-analysis command line tool the pillars and the verifier may run. */
export type AnalysisTool = {
  name: string
  description: string
  guide: AnalysisGuide
  /** Command prefixes of at least two words, so a grant is never a whole binary. */
  commands: string[]
}

const TOOL_KEYS = ['name', 'description', 'guide', 'commands']
const NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/u
const MAX_DESCRIPTION = 300
const MAX_TEXT = 8_000

function guideOf(raw: unknown): AnalysisGuide | string {
  if (isRecord(raw) && Object.keys(raw).length === 1 && 'text' in raw) {
    const { text } = raw
    const valid = typeof text === 'string' && text.trim() !== '' && text.length <= MAX_TEXT
    return valid ? { text: text.trim() } : `"guide.text" must be 1 to ${MAX_TEXT} characters`
  }
  return parseGuide(raw)
}

function tool(raw: Json): AnalysisTool | string {
  const { name, description } = raw
  if (typeof name !== 'string' || !NAME_RE.test(name)) return '"name" must be a simple identifier'
  const oneLine = typeof description === 'string' ? description.replace(/\s+/gu, ' ').trim() : ''
  if (oneLine === '' || oneLine.length > MAX_DESCRIPTION) {
    return `"description" must be one line of at most ${MAX_DESCRIPTION} characters`
  }
  const guide = guideOf(raw.guide)
  if (typeof guide === 'string') return guide
  const commands = parseCommands(raw.commands)
  if (typeof commands === 'string') return commands
  return { name, description: oneLine, guide, commands }
}

/**
 * Parses an `analysis` list. A bad tool is dropped with a problem, so it grants nothing; the rest
 * stay. A list in which every tool is bad is ignored as a whole and the layer below applies.
 */
export function parseAnalysis(
  raw: unknown,
  where: string,
  problems: string[],
): AnalysisTool[] | undefined {
  if (raw === undefined) return undefined
  if (!Array.isArray(raw)) {
    problems.push(`${where}: must be an array; ignored`)
    return undefined
  }
  const tools: AnalysisTool[] = []
  raw.forEach((item: unknown, index) => {
    const here = `${where}[${index}]`
    if (!isRecord(item)) {
      problems.push(`${here}: must be an object; tool ignored`)
      return
    }
    problems.push(...unknownKeys(item, TOOL_KEYS, here))
    const parsed = tool(item)
    if (typeof parsed === 'string') {
      problems.push(`${here}: ${parsed}; tool ignored`)
    } else if (tools.some((known) => known.name.toLowerCase() === parsed.name.toLowerCase())) {
      problems.push(`${here}: name "${parsed.name}" is already used; tool ignored`)
    } else {
      tools.push(parsed)
    }
  })
  return tools.length === 0 && raw.length > 0 ? undefined : tools
}
