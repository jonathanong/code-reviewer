export const IMPACT_KINDS = ['breaking', 'architectural', 'maintenance', 'unsure'] as const
export type ImpactKind = (typeof IMPACT_KINDS)[number]

/** What kind of change the pull request is, as the verifier judged it, with its one-line basis. */
export type Impact = { kind: ImpactKind; basis?: string }

export const BASIS_MAX = 160

function basisOf(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const line = raw.replace(/\s+/gu, ' ').trim()
  if (line === '') return undefined
  return line.length > BASIS_MAX ? `${line.slice(0, BASIS_MAX - 1).trimEnd()}…` : line
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
