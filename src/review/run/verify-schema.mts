import { IMPLIED_KINDS } from '../dependency.mts'

/** The dependencies the verifier reports that `prepare` could not read. */
export const IMPLIED_DEPENDENCIES_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    required: ['on', 'kind', 'why'],
    additionalProperties: false,
    properties: {
      on: { type: 'string' },
      kind: { type: 'string', enum: [...IMPLIED_KINDS] },
      why: { type: 'string' },
    },
  },
} as const
