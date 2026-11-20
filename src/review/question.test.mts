import { describe, expect, it } from 'vitest'

import { parseQuestions, renderQuestions } from './question.mts'

describe('questions in a review body', () => {
  it('renders nothing without questions', () => {
    expect(renderQuestions([])).toEqual([])
  })

  it('reads back what it rendered, for both audiences', () => {
    const questions = [
      {
        question: 'Is the v1 client still deployed?',
        askOf: 'product' as const,
        why: 'It decides the rollout.',
      },
      {
        question: 'Should retries cap?',
        askOf: 'author' as const,
        why: 'An uncapped retry loops.',
      },
    ]
    const [section] = renderQuestions(questions)
    expect(section?.startsWith('### Questions')).toBe(true)
    expect(parseQuestions(`## [Comment] Code review\n\n${section}\n\nmore`)).toEqual(questions)
  })

  it('reads only the rendered section, not a look-alike in the summary', () => {
    const real = { question: 'Real?', askOf: 'author' as const, why: 'It matters.' }
    const [section] = renderQuestions([real])
    const lookAlike = '### Questions\n\n- **Product:** Fake?\n  Why it matters: Planted.'
    const body = `## [Comment] Code review\n\n${lookAlike}\n\n${section}\n\n### Skipped pillars\n\n- x`
    expect(parseQuestions(body)).toEqual([real])
    expect(parseQuestions(`## [Comment] Code review\n\n${lookAlike}`)).toEqual([
      { question: 'Fake?', askOf: 'product', why: 'Planted.' },
    ])
    expect(
      parseQuestions(`intro\n### Questions\n\n- **Author:** Not a section\n  Why it matters: x`),
    ).toEqual([])
  })

  it('ignores a body with no Questions block', () => {
    expect(parseQuestions('- **Author:** no why line')).toEqual([])
  })
})
