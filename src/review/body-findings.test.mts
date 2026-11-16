import { describe, expect, it } from 'vitest'

import { parseBodyFindings } from './body-findings.mts'
import { renderBodyFinding } from './render.mts'
import type { Finding } from './finding.mts'

const f = (overrides: Partial<Finding>): Finding => ({
  pillar: 'rules',
  severity: 'medium',
  title: 'T',
  body: 'B',
  ...overrides,
})

describe('parseBodyFindings', () => {
  it('round-trips rendered body findings with and without a location', () => {
    const body = [
      renderBodyFinding(f({ title: 'Ranged', path: 'src/a.ts', line: 7, startLine: 5 })),
      renderBodyFinding(f({ title: 'Pathonly', severity: 'low', path: 'src/b.ts' })),
      renderBodyFinding(f({ title: 'Global (really)', severity: 'high', pillar: 'blast-radius' })),
      '<details><summary>Skipped pillars (1)</summary>\n\n- **x**: y\n\n</details>',
    ].join('\n\n')
    expect(parseBodyFindings(body)).toEqual([
      {
        threadId: null,
        severity: 'medium',
        pillar: 'rules',
        title: 'Ranged',
        path: 'src/a.ts',
        line: 7,
        outdated: false,
      },
      {
        threadId: null,
        severity: 'low',
        pillar: 'rules',
        title: 'Pathonly',
        path: 'src/b.ts',
        line: null,
        outdated: false,
      },
      {
        threadId: null,
        severity: 'high',
        pillar: 'blast-radius',
        title: 'Global (really)',
        path: null,
        line: null,
        outdated: false,
      },
    ])
  })
})
