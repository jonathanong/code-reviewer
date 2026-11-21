import { PILLARS } from '../pillar-name.mts'

type WithPillar = {
  properties: { findings: { items: { properties: { pillar: object } } } }
}

/**
 * The schema with the configured pillars' names allowed in each finding's `pillar`, so the
 * verifier and the approval check can keep an extra pillar's finding. The schema itself, byte for
 * byte, when no pillar is configured.
 */
export function withExtraPillars(schema: WithPillar, extra: readonly string[]): object {
  if (extra.length === 0) return schema
  const { findings } = schema.properties
  const pillar = { type: 'string', enum: [...PILLARS, ...extra] }
  return {
    ...schema,
    properties: {
      ...schema.properties,
      findings: {
        ...findings,
        items: { ...findings.items, properties: { ...findings.items.properties, pillar } },
      },
    },
  }
}
