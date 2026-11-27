/** The concerns only a person can settle, with the one-line definition the verifier prompt gives each. */
export const FLAG_DEFINITIONS = {
  architecture: 'a large architectural change made without discussion',
  'acceptance-criteria':
    'the acceptance criteria are questionable, or the change does not follow them',
  'feature-sense': 'the feature does not make sense',
  'wrong-intent': 'the change does not do what was meant',
  design: 'a design concern',
  'broken-workflow':
    'the agent that made the change clearly did something wrong, such as a broken process, the wrong branch or junk committed',
  'safeguard-weakened':
    'tests skipped or deleted, checks or thresholds lowered, or permissions broadened to make the change pass',
  irreversible:
    'data deletion, a dropped table or column, a one-way migration or a destructive script',
  'new-service':
    'adds an external service, vendor, paid resource or infrastructure that was not discussed',
  'rule-workaround': 'the agent hacked around a rule, so the process needs updating',
} as const

export type FlagKind = keyof typeof FLAG_DEFINITIONS
export const FLAG_KINDS = Object.keys(FLAG_DEFINITIONS) as FlagKind[]

/** A concern only a person can settle; `run --post auto` holds the review for it. */
export type Flag = {
  kind: FlagKind
  /** One or two sentences: what is wrong and why a person must decide. */
  concern: string
  /** `path:line`, or absent for the pull request as a whole. */
  where?: string
}

export const FLAGS_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['kind', 'concern'],
    additionalProperties: false,
    properties: {
      kind: { type: 'string', enum: [...FLAG_KINDS] },
      concern: { type: 'string' },
      where: { type: 'string' },
    },
  },
} as const
