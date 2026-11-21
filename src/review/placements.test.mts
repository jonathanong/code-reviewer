import { describe, expect, it } from 'vitest'

import { indexReviewFiles } from '../review-payload/index.mts'
import type { Finding } from './finding.mts'
import { findingPlacements } from './placements.mts'

const finding = (over: Partial<Finding>): Finding => ({
  pillar: 'correctness',
  severity: 'low',
  title: 't',
  body: 'b',
  ...over,
})

describe('findingPlacements', () => {
  it('reports inline or body per finding in input order, not sorted order', () => {
    const index = indexReviewFiles([{ filename: 'a.ts', patch: '@@ -1 +1 @@\n+x\n' }])
    const findings = [
      finding({ severity: 'low', path: 'a.ts', line: 1 }),
      finding({ severity: 'blocking' }),
      finding({ severity: 'high', path: 'elsewhere.ts', line: 1 }),
    ]
    expect(findingPlacements(findings, index)).toEqual(['inline', 'body', 'body'])
  })
})
