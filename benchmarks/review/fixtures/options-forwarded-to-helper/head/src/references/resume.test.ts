import { describe, expect, it } from 'vitest'

import { selectResumePoint } from './resume.ts'

describe('selectResumePoint', () => {
  it('skips closed years', () => {
    const lines = ['inv-2026-000004', 'inv-2025-000900']
    expect(selectResumePoint(lines, new Set([2026]))?.sequence).toBe(900)
  })

  it('is undefined when nothing is open', () => {
    expect(selectResumePoint(['note'], new Set())).toBeUndefined()
  })

  it('resumes a deployment that issues its own prefix', () => {
    expect(selectResumePoint(['crn-2026-000007'], new Set(), { prefix: 'crn' })?.sequence).toBe(7)
  })
})
