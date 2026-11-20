import { describe, expect, it } from 'vitest'

import type { Finding, ReviewInput } from './finding.mts'
import { narrationWarnings } from './narration.mts'

function review(overrides: Partial<ReviewInput> = {}, finding: Partial<Finding> = {}): ReviewInput {
  return {
    effort: 'high',
    summary: '',
    skipped: [],
    questions: [],
    findings: [{ pillar: 'rules', severity: 'low', title: 'T', body: 'B', ...finding }],
    ...overrides,
  }
}

describe('narrationWarnings', () => {
  it.each([
    ['The verifier confirmed this against the tree.', 'the verifier'],
    ['The correctness pillar found an off-by-one.', 'a pillar'],
    ['The pillars flagged the same loop.', 'a pillar'],
    ['Raised by the security pillar.', 'a pillar'],
    ['I checked every caller and none pass null.', 'first-person process'],
    ['We verified the lock order.', 'first-person process'],
    ['The review found that retries never stop.', 'the review itself'],
    ['A WebFetch of the docs shows the limit.', 'a tool name'],
    ['The explorer subagent could not find a caller.', 'a tool name'],
    ['Great job extracting this helper.', 'praise'],
    ['LGTM otherwise.', 'praise'],
  ])('flags %s', (body, kind) => {
    expect(narrationWarnings(review({}, { body }))).toEqual([
      expect.stringContaining(`findings[0].body narrates the review (${kind})`),
    ])
  })

  it('leaves a defect described in terms of the code alone', () => {
    const clean = [
      'Retries never stop when the server returns 503, so the queue grows without bound.',
      'The verifier function in auth.ts returns early and skips the signature check.',
      'This pillar of the bridge design is load-bearing: the new layout moves it.',
      'The design pillar tests are renamed but still assert the old behavior.',
      'A reviewer reading this diff would expect checked exceptions; ran is also a word.',
      'The change ran into a rate limit in CI, which is a different matter from nice-to-have.',
    ]
    for (const body of clean) expect(narrationWarnings(review({}, { body }))).toEqual([])
  })

  it('reads the summary, title, questions, and its why, and names where each hit is', () => {
    const warnings = narrationWarnings(
      review(
        {
          summary: 'The verifier found two things.',
          questions: [
            { question: 'Well done on the flag?', askOf: 'author', why: 'I checked it.' },
          ],
        },
        { title: 'Nice work on the cache' },
      ),
    )
    expect(warnings.map((warning) => warning.split(' narrates')[0])).toEqual([
      'summary',
      'findings[0].title',
      'questions[0].question',
      'questions[0].why',
    ])
  })
})
