import { describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import type { StackFile } from '../stack-file.mts'
import { renderStack, reportStack } from './stack-report.mts'

const member = (number: number, title: string) => ({
  number,
  title,
  headRef: `h${number}`,
  baseRef: `b${number}`,
  headSha: 's',
})

const STACK: StackFile = {
  members: [member(1, 'Base'), member(2, 'Mine\nmulti'), member(3, 'Top')],
  index: 1,
  rootBase: 'main',
  rootIsDefault: true,
  staleBase: false,
}

const finding = (body: string): Finding => ({ pillar: 'rules', severity: 'low', title: 't', body })

describe('reportStack', () => {
  it('is undefined for a flat pull request', () => {
    expect(reportStack(undefined, [finding('Fixed in #3: x')])).toBeUndefined()
  })

  it('marks findings whose body says a later member fixes them', () => {
    const report = reportStack(STACK, [
      finding('Real.'),
      finding('Fixed in #3: gone there.'),
      finding('Fixed in #1: earlier member, not later.'),
      finding('Fixed in #99: unknown.'),
    ])
    expect(report?.fixedLater).toEqual([{ finding: 1, pr: 3 }])
    expect(report?.members).toEqual([
      { number: 1, title: 'Base' },
      { number: 2, title: 'Mine multi' },
      { number: 3, title: 'Top' },
    ])
    expect(report).toMatchObject({ index: 1, rootBase: 'main', rootIsDefault: true })
  })
})

describe('renderStack', () => {
  const report = reportStack(STACK, []) as NonNullable<ReturnType<typeof reportStack>>

  it('lists the members and the position', () => {
    const text = renderStack(report).join('\n')
    expect(text).toContain('member 2 of 3, bottom-up')
    expect(text).toContain('2. #2 Mine multi (this pull request)')
    expect(text).toContain('Root base: `main`.')
  })

  it('notes an off-base stack and a stale base', () => {
    expect(renderStack({ ...report, rootIsDefault: false }).join('\n')).toContain('Off-base')
    expect(renderStack({ ...report, rootIsDefault: false, staleBase: true }).join('\n')).toContain(
      'Stale base',
    )
  })
})
