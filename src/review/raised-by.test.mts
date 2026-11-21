import { describe, expect, it } from 'vitest'

import { buildFollowUpContext } from './context.mts'
import type { PrConversation } from './context-query.mts'
import { parseReviewInput, ReviewError, type Finding } from './finding.mts'
import { renderBodyFinding, renderFindingBody, reviewMarker } from './render.mts'

const LINK = 'https://example.test/pull/1#discussion_r1'
const credited = {
  pillar: 'correctness',
  severity: 'blocking',
  title: 'Stale cache',
  body: 'The cache is never invalidated.',
  path: 'a.ts',
  line: 3,
  raisedBy: { login: 'codex[bot]', url: LINK },
}
const review = (findings: unknown[]) => ({ summary: 's', findings })
const parsed = (finding: unknown): Finding => parseReviewInput(review([finding])).findings[0]!

describe('raisedBy on a finding', () => {
  it('survives parsing and renders as a link with no notifying mention', () => {
    const finding = parsed(credited)
    expect(finding.raisedBy).toEqual({ login: 'codex[bot]', url: LINK })
    for (const text of [renderFindingBody(finding), renderBodyFinding(finding)]) {
      expect(text).toContain(`Also raised by [codex](${LINK})`)
      expect(text).not.toContain('@')
    }
  })

  it('leaves a finding without it unchanged', () => {
    const { raisedBy: _unused, ...plain } = credited
    const finding = parsed(plain)
    expect(finding).not.toHaveProperty('raisedBy')
    expect(renderFindingBody(finding)).not.toContain('Also raised by')
  })

  it('rejects a malformed credit', () => {
    const bad = (raisedBy: unknown) => () => parsed({ ...credited, raisedBy })
    expect(bad('codex')).toThrow(ReviewError)
    expect(bad({ login: '@codex', url: LINK })).toThrow('login')
    expect(bad({ login: 'codex', url: 'http://example.test/x' })).toThrow('https link')
    expect(bad({ login: 'codex', url: 'https://x.test/a)b' })).toThrow('https link')
  })

  it('does not stop a later review from reading the posted comment as a finding', () => {
    const marker = reviewMarker('a'.repeat(40), 'Request Changes', 'high')
    const pull = {
      title: 'T',
      body: '',
      author: { login: 'dev', __typename: 'User' },
      closingIssuesReferences: { nodes: [] },
      headRefOid: 'a'.repeat(40),
      baseRefOid: 'b'.repeat(40),
      additions: 1,
      deletions: 1,
      reviews: {
        nodes: [
          {
            id: 'R',
            author: { login: 'bot' },
            state: 'COMMENTED',
            body: marker,
            submittedAt: null,
            commit: null,
          },
        ],
      },
      reviewThreads: {
        nodes: [
          {
            id: 'T1',
            isResolved: false,
            isOutdated: false,
            path: 'a.ts',
            line: 3,
            comments: {
              nodes: [
                {
                  author: { login: 'bot' },
                  body: renderFindingBody(parsed(credited)),
                  createdAt: 't',
                  pullRequestReview: { id: 'R' },
                },
              ],
            },
          },
        ],
      },
      comments: { nodes: [] },
      commits: { nodes: [] },
    } as unknown as PrConversation
    const context = buildFollowUpContext(pull, new Set(['bot']))
    expect(context.unresolved).toMatchObject([
      { threadId: 'T1', severity: 'blocking', title: 'Stale cache', pillar: 'correctness' },
    ])
  })
})
