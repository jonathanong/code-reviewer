import { describe, expect, it } from 'vitest'

import { validateEvidenceOutput } from './evidence-schema.mts'

const KNOWN = { sources: ['aws', 'dd'], findings: ['F1', 'F2'] }

const CHECKED = {
  name: 'aws',
  status: 'checked',
  queries: [
    {
      command: 'aws logs filter-log-events --log-group-name /app',
      result: '0 events',
      control: { command: 'aws logs filter-log-events --log-group-name /app --wide', result: '12' },
    },
  ],
}

const answer = (over: Record<string, unknown> = {}) => ({
  sources: [CHECKED],
  findings: [{ id: 'F1', effect: 'contradicts', note: 'No such calls.', sources: ['aws'] }],
  claims: [{ claim: 'Called 10 times a day', effect: 'supports', note: 'Median 9.' }],
  ...over,
})

describe('validateEvidenceOutput', () => {
  it('keeps a well-formed answer, control queries included', () => {
    expect(validateEvidenceOutput(answer(), KNOWN)).toEqual({
      sources: [CHECKED],
      findings: [{ id: 'F1', effect: 'contradicts', note: 'No such calls.', sources: ['aws'] }],
      claims: [{ claim: 'Called 10 times a day', effect: 'supports', note: 'Median 9.' }],
    })
  })

  it('accepts a blocked source with its error and a not-applicable source with a reason', () => {
    const sources = [
      { name: 'aws', status: 'blocked', reason: 'AccessDenied: not authorized', queries: [] },
      { name: 'dd', status: 'not-applicable', reason: 'No metrics change.', queries: [] },
    ]
    expect(validateEvidenceOutput(answer({ sources }), KNOWN).sources).toEqual(sources)
  })

  it.each([
    ['not an object', 'text'],
    ['no sources array', answer({ sources: undefined })],
    ['no findings array', answer({ findings: 'none' })],
    ['an invalid status', answer({ sources: [{ ...CHECKED, status: 'done' }] })],
    ['an invalid effect', answer({ findings: [{ id: 'F1', effect: 'maybe', note: '' }] })],
    ['a checked source with no query', answer({ sources: [{ ...CHECKED, queries: [] }] })],
    [
      'a checked source whose only query has no command',
      answer({ sources: [{ ...CHECKED, queries: [{ command: ' ', result: 'x' }] }] }),
    ],
    [
      'a blocked source with no error text',
      answer({ sources: [{ name: 'aws', status: 'blocked', queries: [] }] }),
    ],
  ])('rejects %s so the run is retried', (_what, value) => {
    expect(() => validateEvidenceOutput(value, KNOWN)).toThrow()
  })

  it('drops sources and findings the run was not given, and repeated sources', () => {
    const output = validateEvidenceOutput(
      answer({
        sources: [CHECKED, CHECKED, { name: 'made-up', status: 'checked', queries: [] }, 'x'],
        findings: [
          { id: 'F9', effect: 'supports', note: 'n' },
          { id: 'F2', effect: 'none', note: 'n', sources: ['aws', 'made-up'] },
          { id: 'F1', effect: 'none', note: 'n', sources: 'aws' },
        ],
      }),
      KNOWN,
    )
    expect(output.sources).toEqual([CHECKED])
    expect(output.findings).toEqual([
      { id: 'F2', effect: 'none', note: 'n', sources: ['aws'] },
      { id: 'F1', effect: 'none', note: 'n' },
    ])
  })

  it('flattens and bounds text so one answer cannot flood the report or a posted note', () => {
    const output = validateEvidenceOutput(
      answer({
        findings: [{ id: 'F1', effect: 'supports', note: `a\n b ${'x'.repeat(400)}` }],
        sources: [
          {
            ...CHECKED,
            queries: [{ command: 'aws logs x', result: `r\n${'y'.repeat(3000)}` }, 'not a query'],
          },
        ],
      }),
      KNOWN,
    )
    const [note] = output.findings
    expect(note?.note.startsWith('a b xxx')).toBe(true)
    expect(note?.note).toHaveLength(300)
    expect(output.sources[0]?.queries[0]?.result).toHaveLength(2000)
  })
})
