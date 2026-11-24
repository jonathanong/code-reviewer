import { VERIFIER_OUTPUT_SCHEMA } from '../benchmark/verifier-run.mts'
import { IMPLIED_KINDS } from '../dependency.mts'
import { DISPROVED_SCHEMA } from './disproved.mts'

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

/** The benchmark's verifier schema plus the pull request summary, a reason per dropped input, and the checks a kept finding disproves. */
export const REVIEW_VERIFIER_SCHEMA = {
  ...VERIFIER_OUTPUT_SCHEMA,
  required: [...VERIFIER_OUTPUT_SCHEMA.required, 'pullRequestSummary'],
  properties: {
    ...VERIFIER_OUTPUT_SCHEMA.properties,
    pullRequestSummary: { type: 'string' },
    fixedThreadIds: { type: 'array', items: { type: 'string' } },
    dependencies: IMPLIED_DEPENDENCIES_SCHEMA,
    disproved: DISPROVED_SCHEMA,
    dropped: {
      type: 'array',
      items: {
        type: 'object',
        required: ['index', 'reason'],
        additionalProperties: false,
        properties: { index: { type: 'integer', minimum: 0 }, reason: { type: 'string' } },
      },
    },
  },
} as const
