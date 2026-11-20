import type { HoldRule, RunSettings } from '../review/rules/run-parse.mts'

/** What the hold rules look at; every field is read from the finished run or from GitHub. */
export type HoldFacts = {
  /** Open questions in the review. */
  questions: number
  files: number
  /** Changed lines outside generated files. */
  lines: number
  /** Places the diff or the conversation was cut short. */
  truncated: string[]
  /** Changed paths the dispatcher sends to the security pillar. */
  securityPaths: string[]
  /** Pillars, the evidence run or the verifier that failed or were blocked. */
  partial: string[]
  authMode: 'app' | 'gh'
  /** Posted text over three times its target, which a real post refuses. */
  tooLong: string[]
}

/** `post-hold` is `--post hold`, which is a request and not a configurable rule. */
export type Held = { rule: HoldRule | 'post-hold'; why: string }

/** The enabled rules that match, in a fixed order. An empty list means the review may be posted. */
export function holdRules(facts: HoldFacts, settings: RunSettings): Held[] {
  const { rules, largeChange } = settings
  const checks: Array<[HoldRule, string | undefined]> = [
    [
      'unclear-intent',
      facts.questions > 0 ? `${facts.questions} open question(s) need an answer` : undefined,
    ],
    [
      'large-change',
      facts.files > largeChange.files || facts.lines > largeChange.lines
        ? `${facts.files} files and ${facts.lines} changed lines, over ${largeChange.files} files or ${largeChange.lines} lines`
        : facts.truncated.length > 0
          ? `cut short: ${facts.truncated.join('; ')}`
          : undefined,
    ],
    [
      'risky-change',
      facts.securityPaths.length > 0
        ? `touches security paths: ${facts.securityPaths.slice(0, 5).join(', ')}`
        : undefined,
    ],
    ['partial-failure', facts.partial.length > 0 ? facts.partial.join('; ') : undefined],
    [
      'not-app-identity',
      facts.authMode === 'app' ? undefined : 'calls use the local gh login, not the GitHub App',
    ],
    [
      'text-too-long',
      facts.tooLong.length > 0
        ? `posted text is over three times its target: ${facts.tooLong.join('; ')}`
        : undefined,
    ],
  ]
  return checks.flatMap(([rule, why]) => (rules[rule] && why !== undefined ? [{ rule, why }] : []))
}
