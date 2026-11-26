import { describe, expect, it } from 'vitest'

import { ReviewError, parseReviewInput } from './finding.mts'

const base = { pillar: 'rules', severity: 'high', title: ' T ', body: ' B ' }

function finding(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...base, ...extra }
}

function parseOne(extra: Record<string, unknown>) {
  return parseReviewInput({ findings: [finding(extra)] }).findings[0]
}

function failure(raw: unknown): string {
  try {
    parseReviewInput(raw)
  } catch (error) {
    expect(error).toBeInstanceOf(ReviewError)
    expect((error as Error).name).toBe('ReviewError')
    return (error as Error).message
  }
  throw new Error('expected a failure')
}

describe('parseReviewInput', () => {
  it('applies defaults for an empty object', () => {
    expect(parseReviewInput({})).toEqual({
      effort: 'high',
      summary: '',
      skipped: [],
      findings: [],
      questions: [],
    })
  })

  it('keeps a well-formed reviewId and rejects one that cannot sit in a marker', () => {
    expect(parseReviewInput({ reviewId: 'abcdefgh-12' }).reviewId).toBe('abcdefgh-12')
    expect(() => parseReviewInput({ reviewId: 'a b' })).toThrow(/reviewId/u)
    expect(() => parseReviewInput({ reviewId: 7 })).toThrow(/reviewId/u)
  })

  it('parses effort, summary, skipped pillars, and trimmed findings', () => {
    expect(
      parseReviewInput({
        effort: 'low',
        summary: '  hi  ',
        skipped: [{ pillar: 'history', reason: 'no history' }],
        findings: [finding()],
      }),
    ).toEqual({
      effort: 'low',
      summary: 'hi',
      skipped: [{ pillar: 'history', reason: 'no history' }],
      findings: [{ pillar: 'rules', severity: 'high', title: 'T', body: 'B' }],
      questions: [],
    })
  })

  it('parses questions and rejects malformed ones', () => {
    const ask = { question: ' Q? ', askOf: 'product', why: ' W ' }
    expect(parseReviewInput({ questions: [ask] }).questions).toEqual([
      { question: 'Q?', askOf: 'product', why: 'W' },
    ])
    expect(failure({ questions: 'x' })).toBe('questions must be an array.')
    expect(failure({ questions: [null] })).toBe('questions[0] must be an object.')
    expect(failure({ questions: [{ ...ask, askOf: 'me' }] })).toContain('questions[0].askOf')
    expect(failure({ questions: [{ ...ask, why: ' ' }] })).toBe(
      'questions[0].why must be a non-empty string.',
    )
    expect(failure({ questions: [{ ...ask, question: '' }] })).toContain('questions[0].question')
  })

  it('checks an optional verdict against the findings and questions', () => {
    expect(parseReviewInput({ verdict: 'Approve' }).findings).toEqual([])
    expect(
      failure({ verdict: 'Approve', findings: [finding({ severity: 'blocking' })] }),
    ).toContain('does not match')
    expect(
      failure({ verdict: 'Approve', questions: [{ question: 'Q', askOf: 'author', why: 'W' }] }),
    ).toContain('(Comment)')
    expect(failure({ verdict: 'Maybe' })).toContain('verdict must be one of')
  })

  it('keeps trimmed notes, bounded in count and length, and omits an empty list', () => {
    expect(parseReviewInput({ notes: [] })).not.toHaveProperty('notes')
    expect(parseReviewInput({ notes: ['  a note  '] }).notes).toEqual(['a note'])
    const many = parseReviewInput({ notes: Array.from({ length: 12 }, () => 'n') }).notes
    expect(many).toHaveLength(10)
    expect(parseReviewInput({ notes: ['x'.repeat(900)] }).notes?.[0]).toHaveLength(600)
  })

  it('keeps well-formed dependencies, capped, and omits an empty list', () => {
    const dep = { on: ' #1 ', kind: 'pull', state: 'open', why: ' w ' }
    expect(parseReviewInput({ dependencies: [] })).not.toHaveProperty('dependencies')
    expect(parseReviewInput({ dependencies: [dep] }).dependencies).toEqual([
      { on: '#1', kind: 'pull', state: 'open', why: 'w' },
    ])
    const many = Array.from({ length: 20 }, () => dep)
    expect(parseReviewInput({ dependencies: many }).dependencies).toHaveLength(15)
  })

  it('rejects dependencies of the wrong shape', () => {
    expect(failure({ dependencies: 'x' })).toBe('dependencies must be an array.')
    expect(failure({ dependencies: [3] })).toBe('dependencies[0] must be an object.')
    expect(
      failure({ dependencies: [{ on: '#1', kind: 'nope', state: 'open', why: 'w' }] }),
    ).toContain('dependencies[0].kind')
  })

  it('rejects notes that are not a list of non-empty strings', () => {
    expect(failure({ notes: 'x' })).toBe('notes must be an array.')
    expect(failure({ notes: [' '] })).toBe('notes[0] must be a non-empty string.')
    expect(failure({ notes: [3] })).toBe('notes[0] must be a non-empty string.')
  })

  it('ignores a non-string summary', () => {
    expect(parseReviewInput({ summary: 4 }).summary).toBe('')
  })

  it('rejects non-objects and bad lists', () => {
    expect(failure(null)).toBe('Input must be a JSON object.')
    expect(failure([])).toBe('Input must be a JSON object.')
    expect(failure('x')).toBe('Input must be a JSON object.')
    expect(failure({ findings: 'x' })).toBe('findings must be an array.')
    expect(failure({ skipped: {} })).toBe('skipped must be an array.')
    expect(failure({ effort: 'max' })).toBe('effort must be one of low, medium, high.')
  })

  it('keeps a prevention note as one line and drops a blank one', () => {
    expect(parseOne({ prevent: '  an oxlint\n rule   banning x ' })?.prevent).toBe(
      'an oxlint rule banning x',
    )
    expect(parseOne({ prevent: '  ' })).not.toHaveProperty('prevent')
    expect(parseOne({})).not.toHaveProperty('prevent')
    expect(failure({ findings: [finding({ prevent: 3 })] })).toBe(
      'findings[0].prevent must be a string.',
    )
  })

  it('accepts the approval check under skipped and derives the verdict with it', () => {
    const skipped = [{ pillar: 'approval-check', reason: 'did not finish' }]
    expect(parseReviewInput({ skipped }).skipped).toEqual(skipped)
    expect(parseReviewInput({ skipped, verdict: 'Comment' }).skipped).toEqual(skipped)
    expect(failure({ skipped, verdict: 'Approve' })).toContain('does not match')
  })

  it('accepts a well-formed name for a configured pillar in findings and skipped', () => {
    const parsed = parseReviewInput({
      findings: [finding({ pillar: 'accessibility' })],
      skipped: [{ pillar: 'accessibility', reason: 'failed' }],
    })
    expect(parsed.findings[0]?.pillar).toBe('accessibility')
    expect(parsed.skipped[0]?.pillar).toBe('accessibility')
  })

  it('rejects malformed findings and skipped entries', () => {
    expect(failure({ findings: [1] })).toBe('findings[0] must be an object.')
    expect(failure({ skipped: [null] })).toBe('skipped[0] must be an object.')
    expect(failure({ skipped: [{ pillar: 'Not A Pillar', reason: 'x' }] })).toContain(
      'skipped[0].pillar',
    )
    expect(failure({ skipped: [{ pillar: 'rules', reason: ' ' }] })).toBe(
      'skipped[0].reason must be a non-empty string.',
    )
    expect(failure({ findings: [finding({ pillar: '1x' })] })).toContain('findings[0].pillar')
    expect(failure({ findings: [finding({ pillar: 3 })] })).toContain('or a configured pillar')
    expect(failure({ findings: [finding({ pillar: 'approval-check' })] })).toContain(
      'findings[0].pillar',
    )
    expect(failure({ findings: [finding({ severity: 'x' })] })).toContain('findings[0].severity')
    expect(failure({ findings: [finding({ title: '' })] })).toBe(
      'findings[0].title must be a non-empty string.',
    )
    expect(failure({ findings: [finding({ body: 3 })] })).toBe(
      'findings[0].body must be a non-empty string.',
    )
  })
})

describe('finding locations', () => {
  it('accepts findings without a location', () => {
    expect(parseOne({})).not.toHaveProperty('path')
  })

  it('accepts a path only, and a path with a line defaulting to RIGHT', () => {
    expect(parseOne({ path: 'a.ts' })).toMatchObject({ path: 'a.ts' })
    expect(parseOne({ path: 'a.ts' })).not.toHaveProperty('line')
    expect(parseOne({ path: 'a.ts', line: 3 })).toMatchObject({
      path: 'a.ts',
      line: 3,
      side: 'RIGHT',
    })
    expect(parseOne({ path: 'a.ts', line: 3, side: 'LEFT' })).toMatchObject({ side: 'LEFT' })
    expect(parseOne({ path: 'a.ts', line: 3, startLine: 1 })).toMatchObject({ startLine: 1 })
  })

  it('normalizes one-line and reversed ranges', () => {
    expect(parseOne({ path: 'a.ts', line: 3, startLine: 3 })).not.toHaveProperty('startLine')
    expect(parseOne({ path: 'a.ts', line: 3, startLine: 7 })).toMatchObject({
      line: 7,
      startLine: 3,
    })
  })

  it('rejects invalid locations', () => {
    const message = (extra: Record<string, unknown>) => failure({ findings: [finding(extra)] })
    expect(message({ line: 3 })).toBe('findings[0].line needs a path.')
    expect(message({ path: 'a\0b' })).toBe('findings[0].path is invalid.')
    expect(message({ path: '' })).toContain('findings[0].path')
    expect(message({ path: 'a', line: 0 })).toBe('findings[0].line must be a positive integer.')
    expect(message({ path: 'a', line: 1.5 })).toBe('findings[0].line must be a positive integer.')
    expect(message({ path: 'a', line: '1' })).toBe('findings[0].line must be a positive integer.')
    expect(message({ path: 'a', line: 2, side: 'MID' })).toContain('findings[0].side')
    expect(message({ path: 'a', line: 2, startLine: 0 })).toBe(
      'findings[0].startLine must be a positive integer.',
    )
  })
})
