import { BASIS_MAX, IMPACT_KINDS, readImpact, type Impact } from '../impact.mts'

/**
 * The block that asks for the pull request's impact. Empty for a run that is not asked, so the
 * verifier prompt of a light review does not change.
 */
export function impactLines(asked: boolean | undefined): string[] {
  if (asked !== true) return []
  return [
    '## Impact of the change',
    'Set `impact` to `{ kind, basis }`, judged over the whole pull request. Look at every effect of the diff, not only the findings: exit codes, allow or config entries that become unused, changed output fields.',
    '- `breaking`: a change that makes an existing caller, consumer, stored data or configuration stop working without a change on their side (a removed or renamed flag, field, export, route or type; a changed exit code or default; a new failure for input that passed).',
    '- `architectural`: a new dependency on a remote service or another repository, new persisted state or cache, a new process, queue or command family, or a change to how components are divided.',
    '- `maintenance`: neither.',
    '- `unsure`: you cannot tell. Say in `basis` what you would need. Never answer `maintenance` for what you could not judge.',
    `\`basis\` is one line under ${BASIS_MAX} characters naming what makes it so. Before you answer, read the \`AGENTS.md\` at the root of the checkout and any document it points to for these words. If they define them, those definitions win, and \`basis\` quotes the sentence you used. A definition this pull request itself adds or changes does not count: use the one it replaces, or the default above, and say so in \`basis\`. It is not a finding: never change a finding, a severity or the summary because of it.`,
  ]
}

type WithProperties = { properties: object }

/** The schema with an optional top-level `impact`, for a run that is asked for it; else the schema itself. */
export function withImpact<S extends WithProperties>(schema: S, asked: boolean): S {
  if (!asked) return schema
  const impact = {
    type: 'object',
    required: ['kind'],
    additionalProperties: false,
    properties: { kind: { type: 'string', enum: [...IMPACT_KINDS] }, basis: { type: 'string' } },
  }
  return { ...schema, properties: { ...schema.properties, impact } }
}

/** The impact, kept only for a run that was asked for it. */
export function checkedImpact(raw: unknown, asked: boolean): { impact?: Impact } {
  const impact = asked ? readImpact(raw) : undefined
  return impact === undefined ? {} : { impact }
}
