import type { ReviewInput } from './finding.mts'

/**
 * Words that narrate how a review was made instead of what is wrong: the agent that found it, what
 * was checked, which tool, praise. Each pattern needs an agent-like phrasing, so code that merely
 * has a "verifier" or a "pillar" in it is not flagged. The check only warns.
 */
const PATTERNS: readonly { kind: string; pattern: RegExp }[] = [
  {
    kind: 'the verifier',
    pattern:
      /\bthe verifier (?:found|confirmed|checked|verified|rated|re-rated|dropped|kept|flagged|merged|noticed)\b/iu,
  },
  {
    kind: 'a pillar',
    pattern:
      /\b(?:the (?:(?:correctness|design|security|rules|history|congruence|blast-radius|blast radius) )?pillars? (?:found|flagged|reported|raised|checked|reviewed)|(?:found|flagged|raised|reported) by the (?:[\w-]+ )?pillar)\b/iu,
  },
  {
    kind: 'first-person process',
    pattern:
      /\b(?:i|we) (?:reviewed|checked|verified|confirmed|searched|grepped|inspected|examined|looked at|ran)\b/iu,
  },
  {
    kind: 'the review itself',
    pattern: /\bthe review (?:found|flagged|checked|verified|noticed)\b/iu,
  },
  { kind: 'a tool name', pattern: /\b(?:WebFetch|subagent|Skill tool)\b/u },
  {
    kind: 'praise',
    pattern:
      /\b(?:(?:great|nice|good|excellent) (?:job|work|catch)|well done|nicely done|lgtm)\b/iu,
  },
]

function scan(text: string, where: string): string[] {
  return PATTERNS.flatMap(({ kind, pattern }) => {
    const hit = pattern.exec(text)?.[0]
    return hit === undefined ? [] : [`${where} narrates the review (${kind}): "${hit}"`]
  })
}

/** Warnings for text a review would post that talks about the review, not the defect. */
export function narrationWarnings(input: ReviewInput): string[] {
  return [
    ...scan(input.summary, 'summary'),
    ...input.findings.flatMap((finding, at) => [
      ...scan(finding.title, `findings[${at}].title`),
      ...scan(finding.body, `findings[${at}].body`),
    ]),
    ...input.questions.flatMap((item, at) => [
      ...scan(item.question, `questions[${at}].question`),
      ...scan(item.why, `questions[${at}].why`),
    ]),
  ]
}
