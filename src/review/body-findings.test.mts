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
        body: 'B',
      },
      {
        threadId: null,
        severity: 'low',
        pillar: 'rules',
        title: 'Pathonly',
        path: 'src/b.ts',
        line: null,
        outdated: false,
        body: 'B',
      },
      {
        threadId: null,
        severity: 'high',
        pillar: 'blast-radius',
        title: 'Global (really)',
        path: null,
        line: null,
        outdated: false,
        body: 'B',
      },
    ])
  })

  it('reads a body finding posted in the earlier form, with the pillar in a sub line', () => {
    const body =
      '<details><summary>[low] Naming (src/b.ts:3)</summary>\n\n<sub>design</sub>\n\nx</details>'
    expect(parseBodyFindings(body)).toEqual([
      {
        threadId: null,
        severity: 'low',
        pillar: 'design',
        title: 'Naming',
        path: 'src/b.ts',
        line: 3,
        outdated: false,
        body: 'x',
      },
    ])
  })

  it('carries the posted text with its fix section, and none for an empty block', () => {
    const body = [
      renderBodyFinding(f({ title: 'Fixable', body: 'The claim.', fix: 'Do this.' })),
      '<details><summary>[low · rules] Empty</summary></details>',
    ].join('\n\n')
    const [fixable, empty] = parseBodyFindings(body)
    expect(fixable?.body).toContain('The claim.')
    expect(fixable?.body).toContain('Do this.')
    expect(empty).not.toHaveProperty('body')
  })
})
