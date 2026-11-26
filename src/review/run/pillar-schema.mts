import { SEVERITIES } from '../finding.mts'

/** Output schema every pillar run must satisfy; the pillar name is filled in by the runner. */
export const PILLAR_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['findings'],
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'title', 'body'],
        additionalProperties: false,
        properties: {
          severity: { type: 'string', enum: [...SEVERITIES] },
          title: { type: 'string' },
          body: { type: 'string' },
          path: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
          startLine: { type: 'integer', minimum: 1 },
          fix: { type: 'string' },
          suggestion: { type: 'string' },
          prevent: { type: 'string' },
          preExisting: { type: 'boolean' },
        },
      },
    },
  },
} as const
