import { describe, expect, it } from 'vitest'

import { renderFocusReport, reportFocus } from './focus-report.mts'

describe('focus report helpers', () => {
  it('omits empty focus and droppedTargets from report data', () => {
    expect(reportFocus(undefined, undefined)).toEqual({})
    expect(reportFocus([], [])).toEqual({})
    expect(renderFocusReport(undefined, undefined)).toEqual([])
    expect(renderFocusReport([], [])).toEqual([])
  })

  it('renders focus outcomes with origins, locations, and dropped targets', () => {
    const focus = [
      { point: 'req point', status: 'holds' as const, basis: 'Checked.', path: 'a.ts', line: 3 },
      {
        point: 'target point',
        origin: 'target:unneeded-concurrency-guard' as const,
        status: 'not_checked' as const,
        basis: 'No caller info.',
      },
      {
        point: 'path only',
        origin: 'requester' as const,
        status: 'holds' as const,
        basis: 'Ok.',
        path: 'b.ts',
      },
    ]
    expect(reportFocus(focus, ['extra-target'])).toEqual({
      focus,
      droppedTargets: ['extra-target'],
    })
    const md = renderFocusReport(focus, ['extra-target']).join('\n\n')
    expect(md).toContain('### Focus checks')
    expect(md).toContain('- [requester] **holds**: "req point" — Checked. (`a.ts:3`)')
    expect(md).toContain(
      '- [target:unneeded-concurrency-guard] **not_checked**: "target point" — No caller info.',
    )
    expect(md).toContain('- [requester] **holds**: "path only" — Ok. (`b.ts`)')
    expect(md).toContain('Targets dropped by the 20-point cap: extra-target.')

    const droppedOnly = renderFocusReport(undefined, ['unneeded-concurrency-guard']).join('\n\n')
    expect(droppedOnly).toBe(
      '### Focus checks\n\nTargets dropped by the 20-point cap: unneeded-concurrency-guard.',
    )
  })
})
