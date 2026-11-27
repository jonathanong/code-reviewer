import { describe, expect, it } from 'vitest'

import type { FollowUpContext } from './context.mts'
import { renderFollowUpContext } from './context-render.mts'

const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)

function context(overrides: Partial<FollowUpContext> = {}): FollowUpContext {
  return {
    title: 'T',
    author: 'octocat',
    intent: { body: '', issues: [] },
    headSha: HEAD,
    baseSha: BASE,
    lines: 12,
    reviewedSha: null,
    verdict: null,
    effort: null,
    commitsSince: null,
    unread: { threads: 0, ownReview: false },
    olderSkipped: false,
    unresolved: [],
    priorQuestions: [],
    others: [],
    othersDropped: 0,
    restatable: [],
    answerable: [],
    ...overrides,
  }
}

describe('renderFollowUpContext', () => {
  it('renders a pull request with no earlier review', () => {
    const out = renderFollowUpContext(context())
    expect(out).toContain('Untrusted data from the pull request')
    expect(out).toContain(
      `- Head: \`${'a'.repeat(12)}\`, base: \`${'b'.repeat(12)}\`, 12 changed lines`,
    )
    expect(out).toContain('- No earlier review.')
    expect(out).toContain('## Unresolved review findings (0)')
    expect(out).toContain('## Intent (untrusted)')
    expect(out).toContain('Title: T')
    expect(out).toContain('## Other reviewers and comments (0)')
    expect(out.endsWith('\n')).toBe(true)
  })

  it('quotes each referenced issue as untrusted, and changes nothing without any', () => {
    expect(renderFollowUpContext(context(), [])).toBe(renderFollowUpContext(context()))
    const out = renderFollowUpContext(context(), [
      { ref: 'acme/lib#2', state: 'open', title: 'Add retries', body: 'Line one\nLine two' },
    ])
    expect(out).toContain(
      'Referenced issue acme/lib#2 (open, untrusted): Add retries\n> Line one\n> Line two',
    )
    expect(out.indexOf('Referenced issue')).toBeLessThan(out.indexOf('## Unresolved'))
  })

  it('ends the verifier text at the empty heading when there are no notes', () => {
    expect(
      renderFollowUpContext(context()).endsWith('## Other reviewers and comments (0)\n\n'),
    ).toBe(true)
  })

  it('labels each note by kind and bot, and says when older notes were cut', () => {
    const out = renderFollowUpContext(
      context({
        othersDropped: 3,
        others: [
          {
            author: 'robo',
            kind: 'review summary',
            bot: true,
            where: 'commented @abc1234',
            text: 'a',
          },
          { author: 'dan', kind: 'thread', bot: false, where: 'a.ts:3', text: 'b' },
        ],
      }),
    )
    expect(out).toContain(
      '(2)\n\n- [3 more not shown]\n- **robo** [bot, review summary] commented @abc1234: a\n- **dan** [thread] a.ts:3: b\n',
    )
  })

  it('lists commits since the earlier review', () => {
    const out = renderFollowUpContext(
      context({
        reviewedSha: 'c'.repeat(40),
        verdict: 'Approve',
        effort: 'high',
        commitsSince: ['fix one', 'fix two'],
      }),
    )
    expect(out).toContain(`- Last review: \`${'c'.repeat(12)}\` (Approve, high effort)`)
    expect(out).toContain('- Commits since: 2\n  - fix one\n  - fix two')
  })

  it('lists open questions only when there are some', () => {
    const asked = renderFollowUpContext(
      context({ priorQuestions: [{ question: 'Is v1 gone?', askOf: 'product', why: 'Rollout.' }] }),
    )
    expect(asked).toContain('## Open questions from the last review (1)')
    expect(asked).toContain('- (product) Is v1 gone? Why it matters: Rollout.')
    expect(renderFollowUpContext(context())).not.toContain('Open questions')
  })

  it('notes what the conversation read left out', () => {
    expect(renderFollowUpContext(context())).not.toContain('not read')
    expect(renderFollowUpContext(context({ olderSkipped: true }))).toContain(
      'Older resolved or hidden threads and older reviews were not read.',
    )
    expect(renderFollowUpContext(context({ unread: { threads: 7, ownReview: false } }))).toContain(
      '7 older review threads were not read; an open one may be missing.',
    )
    expect(renderFollowUpContext(context({ unread: { threads: 0, ownReview: true } }))).toContain(
      'This reviewer may have reviewed earlier',
    )
  })

  it('notes a reviewed sha missing from history', () => {
    const out = renderFollowUpContext(
      context({ reviewedSha: 'c'.repeat(40), verdict: 'Comment', effort: 'low' }),
    )
    expect(out).toContain('- The reviewed SHA is not in the recent history')
    expect(out).not.toContain('Commits since')
  })

  it('marks an empty description', () => {
    expect(renderFollowUpContext(context())).toContain('Description:\n> (empty)')
  })

  it('renders unresolved findings and other notes', () => {
    const out = renderFollowUpContext(
      context({
        unresolved: [
          {
            threadId: 'T1',
            severity: 'high',
            pillar: 'correctness',
            title: 'Bug',
            path: 'a.ts',
            line: 4,
            outdated: false,
            replies: [{ login: 'dev', text: 'pre-1.0, we will bump a minor' }],
            moreReplies: 2,
          },
          {
            threadId: null,
            severity: 'medium',
            pillar: 'design',
            title: 'Global',
            path: null,
            line: null,
            outdated: false,
          },
          {
            threadId: 'T2',
            severity: 'low',
            pillar: 'style',
            title: 'Nit',
            path: 'b.ts',
            line: null,
            outdated: true,
          },
        ],
        intent: { body: 'Line1\nLine2', issues: [{ number: 3, title: 'Bug', body: 'it breaks' }] },
        others: [{ author: 'bob', kind: 'issue comment', bot: false, where: '', text: 'hello' }],
      }),
    )
    expect(out).toContain(
      '- [high] Bug (correctness; a.ts:4; thread `T1`)\n  - reply by dev: pre-1.0, we will bump a minor\n  - [2 more replies not shown]',
    )
    expect(out).toContain('- Pull request author:')
    expect(out).toContain('- [low] Nit (style; b.ts:file, outdated; thread `T2`)')
    expect(out).toContain('- [medium] Global (design; PR-level; no thread (review body))')
    expect(out).toContain('## Intent (untrusted)')
    expect(out).toContain('Title: T')
    expect(out).toContain('> Line1\n> Line2')
    expect(out).toContain('Closing issue #3: Bug\n> it breaks')
    expect(out).toContain('## Other reviewers and comments (1)')
    expect(out).toContain('- **bob** [issue comment]: hello')
  })
})
