/** A coarse tier so a table of stated severities can be compared; never a judgement of validity. */
export type Tier = 'blocking' | 'high' | 'medium' | 'low'

export type SeverityMarker = {
  reviewer: string
  /** Matches the text a reviewer writes; capture group 1 is the stated label. */
  pattern: RegExp
  /** The tier of each stated label, lower-cased. */
  tiers: Readonly<Record<string, Tier>>
}

/**
 * The one table of markers real reviewers put in a comment to state a severity. A comment
 * matching none has an `unstated` severity.
 */
export const SEVERITY_MARKERS: readonly SeverityMarker[] = [
  {
    reviewer: 'CodeRabbit',
    pattern: /_(?:🔴|🟠|🟡|🔵|🧹)\s*(Critical|Major|Minor|Trivial|Nitpick)_/u,
    tiers: { critical: 'blocking', major: 'high', minor: 'medium', trivial: 'low', nitpick: 'low' },
  },
  {
    reviewer: 'Codex',
    pattern: /!\[(P[0-3]) Badge\]/u,
    tiers: { p0: 'blocking', p1: 'high', p2: 'medium', p3: 'low' },
  },
  {
    reviewer: 'Gemini Code Assist',
    pattern: /!\[(critical|high|medium|low)\]\(https:\/\/www\.gstatic\.com\/codereviewagent\//iu,
    tiers: { critical: 'blocking', high: 'high', medium: 'medium', low: 'low' },
  },
  {
    reviewer: 'Cursor Bugbot',
    pattern: /\*\*(Critical|High|Medium|Low) Severity\*\*/u,
    tiers: { critical: 'blocking', high: 'high', medium: 'medium', low: 'low' },
  },
]

export type StatedSeverity = { reviewer: string; label: string; tier: Tier } | null

/** The severity a comment states through a known marker, else null. */
export function statedSeverity(text: string): StatedSeverity {
  for (const marker of SEVERITY_MARKERS) {
    const label = marker.pattern.exec(text)?.[1]
    const tier = label === undefined ? undefined : marker.tiers[label.toLowerCase()]
    if (label !== undefined && tier !== undefined) return { reviewer: marker.reviewer, label, tier }
  }
  return null
}

const RANK: Record<Tier, number> = { blocking: 0, high: 1, medium: 2, low: 3 }

/** Sort key: stated severities by tier, then everything unstated. */
export const tierRank = (severity: StatedSeverity): number =>
  severity === null ? 4 : RANK[severity.tier]
