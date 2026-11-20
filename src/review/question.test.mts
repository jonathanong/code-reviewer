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

  it('ignores a body with no Questions block', () => {
    expect(parseQuestions('- **Author:** no why line')).toEqual([])
  })
})
