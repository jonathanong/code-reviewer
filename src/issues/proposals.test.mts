import { describe, expect, it } from 'vitest'

import { issueProposals, markerOf, MAX_EVIDENCE } from './proposals.mts'
import { badRule, row } from './issues-fake-io.mts'

describe('issueProposals', () => {
  it('proposes nothing for rules that are fine or working', () => {
    const rows = [
      ...Array.from({ length: 4 }, () => row('fixed', { rule: 'p:good' })),
      row('disputed', { rule: 'p:few' }),
    ]
    expect(issueProposals(rows)).toEqual([])
  })

  it('belongs a rule to its plugin, with a stable key and the marker last', () => {
    const rows = [
      row('disputed', { rule: 'rules-plugin:ts', title: 'First [x]', url: 'https://e.test/1' }),
      row('rejected', { rule: 'rules-plugin:ts', title: 'Second', url: null, pr: 9 }),
      row('fixed', { rule: 'rules-plugin:ts' }),
    ]
    const [proposal, ...rest] = issueProposals(rows)
    expect(rest).toEqual([])
    expect(proposal).toMatchObject({
      key: 'rule:rules-plugin:ts:review',
      target: 'rules-plugin',
      title: 'Review rule rules-plugin:ts: 2 of 3 findings rejected or disputed',
    })
    expect(proposal?.body).toBe(
      [
        'The code reviewer posted 3 findings attributed to the rule `rules-plugin:ts`. Outcomes: fixed 1, disputed 1, rejected 1.',
        '',
        'Evidence (rejected or disputed findings):',
        '',
        '- disputed: [First \\[x\\]](https://e.test/1) in acme/widgets#7',
        '- rejected: [Second](https://github.com/acme/widgets/pull/9) in acme/widgets#9',
        '',
        "Proposed: review the rule's wording and scope for the cases above.",
        '',
        markerOf('rule:rules-plugin:ts:review'),
        '',
      ].join('\n'),
    )
    expect(
      proposal?.body.trimEnd().endsWith('<!-- code-reviewer:issue rule:rules-plugin:ts:review -->'),
    ).toBe(true)
  })

  it('carries titles, links and counts only, never paths or other row fields', () => {
    const [proposal] = issueProposals(badRule('p:s'))
    expect(proposal?.body).not.toContain('secret-path')
    expect(proposal?.body).not.toContain('high')
  })

  it('belongs a pillar to the reviewer', () => {
    const rows = Array.from({ length: 3 }, () => row('rejected', { pillar: 'security' }))
    expect(issueProposals(rows)).toMatchObject([
      { key: 'pillar:security:review', target: 'code-reviewer' },
    ])
  })

  it('keeps a rule name without a plugin as its own target', () => {
    expect(issueProposals(badRule('loose'))).toMatchObject([
      { key: 'rule:loose:loose:review', target: 'loose' },
    ])
  })

  it('lists at most MAX_EVIDENCE links and counts the rest', () => {
    const rows = Array.from({ length: MAX_EVIDENCE + 2 }, () => row('disputed', { rule: 'p:s' }))
    const [proposal] = issueProposals(rows)
    expect(proposal?.body.split('\n').filter((line) => line.startsWith('- disputed'))).toHaveLength(
      MAX_EVIDENCE,
    )
    expect(proposal?.body).toContain('- and 2 more')
  })

  it('puts a multi-line title on one line', () => {
    const rows = Array.from({ length: 3 }, () => row('disputed', { rule: 'p:s', title: 'a\n\nb' }))
    expect(issueProposals(rows)[0]?.body).toContain('[a b]')
  })
})
