export const IMPACT_KINDS = ['breaking', 'architectural', 'maintenance', 'unsure'] as const
export type ImpactKind = (typeof IMPACT_KINDS)[number]

/** What kind of change the pull request is, as the verifier judged it, with its one-line basis. */
export type Impact = { kind: ImpactKind; basis?: string }

export const BASIS_MAX = 160

function basisOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const line = raw.replace(/\s+/gu, ' ').trim()
  if (line === '') return undefined
  return line.length > BASIS_MAX ? `${wholeWords(line, BASIS_MAX - 1)}…` : line
}

/** The first `max` characters without a cut word at the end; a line of one word is cut as it is. */
function wholeWords(line: string, max: number): string {
  const head = line.slice(0, max)
  const end = line[max] === ' ' ? -1 : head.lastIndexOf(' ')
  return (end > 0 ? head.slice(0, end) : head).trimEnd()
}

/** The impact in a model's answer, or nothing when it is not one: a wrong extra is not fatal. */
export function readImpact(raw: unknown): Impact | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const { kind, basis } = raw as { kind?: unknown; basis?: unknown }
  const found = IMPACT_KINDS.find((candidate) => candidate === kind)
  if (found === undefined) return undefined
  const line = basisOf(basis)
  return line === undefined ? { kind: found } : { kind: found, basis: line }
}
