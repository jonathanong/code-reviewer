import { describe, expect, it } from 'vitest'

import type { FollowUpContext } from './context.mts'
import { renderFollowUpContext } from './context-render.mts'

const HEAD = 'a'.repeat(40)
const BASE = 'b'.repeat(40)

function context(overrides: Partial<FollowUpContext> = {}): FollowUpContext {
  return {
    title: 'T',
    intent: { body: '', issues: [] },
    headSha: HEAD,
    baseSha: BASE,
    lines: 12,
    reviewedSha: null,
    verdict: null,
    effort: null,
    commitsSince: null,
    truncated: false,
    unresolved: [],
    others: [],
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

  it('notes a truncated conversation', () => {
    expect(renderFollowUpContext(context({ truncated: true }))).toContain('longer than the newest')
    expect(renderFollowUpContext(context())).not.toContain('longer than the newest')
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
        others: [{ author: 'bob', where: 'comment', text: 'hello' }],
      }),
    )
    expect(out).toContain('- [high] Bug (correctness; a.ts:4; thread `T1`)')
    expect(out).toContain('- [low] Nit (style; b.ts:file, outdated; thread `T2`)')
    expect(out).toContain('- [medium] Global (design; PR-level; no thread (review body))')
    expect(out).toContain('## Intent (untrusted)')
    expect(out).toContain('Title: T')
    expect(out).toContain('> Line1\n> Line2')
    expect(out).toContain('Closing issue #3: Bug\n> it breaks')
    expect(out).toContain('## Other reviewers and comments (1)')
    expect(out).toContain('- **bob** comment: hello')
  })
})
