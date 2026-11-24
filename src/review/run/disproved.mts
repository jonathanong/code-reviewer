/** A kept finding the verifier says disproves a focus check, as the verifier returned it. */
export type Disproof = {
  /** The check's position in the focus list the verifier was shown. */
  check: number
  /** The index in `## Pillar findings` of the finding that disproves it. */
  finding: number
  reason: string
}

/** The verifier's optional `disproved` output: checks answered `holds` or `not_checked` that a kept finding disproves. */
export const DISPROVED_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['check', 'finding', 'reason'],
    additionalProperties: false,
    properties: {
      check: { type: 'integer', minimum: 0 },
      finding: { type: 'integer', minimum: 0 },
      reason: { type: 'string' },
    },
  },
} as const

const isIndex = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0

/** The links the verifier returned, in order; an entry of the wrong shape or with no reason is ignored. */
export function disprovedLinks(raw: unknown): Disproof[] {
  const links: Disproof[] = []
  for (const entry of Array.isArray(raw) ? (raw as unknown[]) : []) {
    const { check, finding, reason } = (entry ?? {}) as Record<string, unknown>
    if (isIndex(check) && isIndex(finding) && typeof reason === 'string' && reason.trim() !== '') {
      links.push({ check, finding, reason: reason.trim() })
    }
  }
  return links
}

/** The schema with `disproved`, for a run that shows focus checks; otherwise unchanged. */
export function withDisproved<S extends { properties: object }>(
  schema: S,
  focus: readonly unknown[] | undefined,
): S {
  if (focus === undefined || focus.length === 0) return schema
  return { ...schema, properties: { ...schema.properties, disproved: DISPROVED_SCHEMA } }
}
