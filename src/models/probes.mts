import { readFileSync } from 'node:fs'

import type { Probe } from './types.mts'

const NAMES = ['off-by-one', 'unawaited-promise', 'inverted-condition']

/** The JSON a probe's reply must match. */
export const PROBE_SCHEMA = {
  type: 'object',
  required: ['findings'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'line', 'title'],
        properties: {
          path: { type: 'string' },
          line: { type: 'integer' },
          title: { type: 'string' },
        },
      },
    },
  },
}

const ASK = `Reply with the defects you found as {"findings":[{"path":"relative/file","line":N,"title":"short"}]}. Use {"findings":[]} when there are none.`

/** The synthetic probes shipped in `probes/`; none holds anything from a reviewed repository. */
export function loadProbes(): Probe[] {
  return NAMES.map((name) => {
    const probe = JSON.parse(
      readFileSync(new URL(`./probes/${name}.json`, import.meta.url), 'utf8'),
    ) as Probe
    return { ...probe, prompt: `${probe.prompt}\n${ASK}` }
  })
}
