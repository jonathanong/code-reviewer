import { VERIFIER_OUTPUT_SCHEMA } from '../benchmark/verifier-run.mts'
import { IMPLIED_KINDS } from '../dependency.mts'
import { DROPPED_SCHEMA } from './verify-dropped.mts'

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

/** The benchmark's verifier schema plus the pull request summary and a reason per dropped input. */
export const REVIEW_VERIFIER_SCHEMA = {
  ...VERIFIER_OUTPUT_SCHEMA,
  required: [...VERIFIER_OUTPUT_SCHEMA.required, 'pullRequestSummary'],
  properties: {
    ...VERIFIER_OUTPUT_SCHEMA.properties,
    pullRequestSummary: { type: 'string' },
    fixedThreadIds: { type: 'array', items: { type: 'string' } },
    dependencies: IMPLIED_DEPENDENCIES_SCHEMA,
    dropped: DROPPED_SCHEMA,
  },
} as const
