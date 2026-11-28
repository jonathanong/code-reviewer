import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import type { PriorFinding } from '../context.mts'
import type { Finding } from '../finding.mts'
import { deriveVerdict } from '../render.mts'
import { asFinding, bodyLines, keepUnanswered, withBodyFindings } from './body-carry.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function runDir(context: object): string {
  const out = mkdtempSync(join(tmpdir(), 'body-carry-'))
  dirs.push(out)
  writeFileSync(join(out, 'context.json'), JSON.stringify(context))
  return out
}

const prior = (rest: Partial<PriorFinding> = {}): PriorFinding => ({
  threadId: null,
  severity: 'high',
  pillar: 'correctness',
  title: 'Raw callee',
  path: 'src/rule.js',
  line: 84,
  outdated: false,
  ...rest,
})
const found = (rest: Partial<Finding> = {}): Finding => ({
  pillar: 'rules',
  severity: 'low',
  title: 'Alias',
  body: 'b',
  ...rest,
})

describe('asFinding', () => {
  it('keeps what the body finding recorded, and the text posted under it', () => {
    expect(asFinding(prior({ body: 'Why' }))).toEqual({
      pillar: 'correctness',
      severity: 'high',
      title: 'Raw callee',
      body: 'Why',
      path: 'src/rule.js',
      line: 84,
    })
  })

  it('drops a line with no path and says where the text is when none was parsed', () => {
    const finding = asFinding(prior({ path: null }))
    expect(finding).toMatchObject({ title: 'Raw callee' })
    expect(finding?.body).toContain('body of the earlier review')
    expect(finding).not.toHaveProperty('path')
    expect(finding).not.toHaveProperty('line')
    expect(asFinding(prior({ line: null }))).not.toHaveProperty('line')
  })

  it('reads no finding whose severity or pillar is not one this reviewer has', () => {
    expect(asFinding(prior({ severity: 'urgent' }))).toBeUndefined()
    expect(asFinding(prior({ pillar: 'Not A Pillar' }))).toBeUndefined()
    expect(asFinding(prior({ pillar: 'config-pillar' }))).toMatchObject({ pillar: 'config-pillar' })
  })
})

describe('withBodyFindings', () => {
  it('appends the findings with no thread after the others and says where they start', () => {
    const out = runDir({
      reviewedSha: 'a'.repeat(40),
      unresolved: [
        prior({ threadId: 'PRRT_1', title: 'Thread' }),
        prior(),
        prior({ title: 'Two' }),
      ],
    })
    const own = [found()]
    const carried = withBodyFindings({ out, findings: own })
    expect(carried.findings.map((finding) => finding.title)).toEqual(['Alias', 'Raw callee', 'Two'])
    expect(carried.block).toEqual({ sha: 'a'.repeat(40), first: 1, count: 2 })
    expect(own).toHaveLength(1)
  })

  it('changes nothing for a run with no unresolved list, only threads, or none it can read', () => {
    const own = [found()]
    for (const context of [
      {},
      { unresolved: [prior({ threadId: 'PRRT_1' })] },
      { unresolved: [prior({ severity: 'urgent' })] },
    ]) {
      expect(withBodyFindings({ out: runDir(context), findings: own })).toEqual({ findings: own })
    }
  })

  it('records no reviewed head when prepare saved none', () => {
    const { block } = withBodyFindings({ out: runDir({ unresolved: [prior()] }), findings: [] })
    expect(block).toEqual({ sha: null, first: 0, count: 1 })
  })
})

describe('keepUnanswered', () => {
  const input = [found(), found({ severity: 'high', title: 'Raw callee' }), found({ title: 'Two' })]
  const block = { sha: null, first: 1, count: 2 }

  it('returns the output as it is without a block', () => {
    const output = { findings: [], sources: [], dropped: new Map<number, string>() }
    expect(keepUnanswered(output, undefined, input)).toBe(output)
  })

  it('returns the output as it is when every body finding is kept or dropped', () => {
    const output = {
      findings: [found()],
      sources: [[1]],
      dropped: new Map([[2, 'The head removed it.']]),
    }
    expect(keepUnanswered(output, block, input)).toBe(output)
  })

  it('re-adds a body finding the verifier neither kept nor dropped, with itself as source', () => {
    const output = { findings: [found()], sources: [[0]], dropped: new Map<number, string>() }
    const kept = keepUnanswered(output, block, input)
    expect(kept.findings.map((finding) => finding.title)).toEqual(['Alias', 'Raw callee', 'Two'])
    expect(kept.sources).toEqual([[0], [1], [2]])
  })

  it('stops an open high finding from becoming an Approve (jongleberry/no-mistakes#4683)', () => {
    // The verifier run of that review: one new low finding from index 0, `dropped: []`, and the
    // earlier high finding with no thread (index 1) neither kept nor dropped.
    const output = { findings: [found()], sources: [[0]], dropped: new Map<number, string>() }
    expect(deriveVerdict(output.findings, [])).toBe('Approve')
    const kept = keepUnanswered(output, { sha: null, first: 1, count: 1 }, input)
    expect(deriveVerdict(kept.findings, [])).toBe('Comment')
  })
})

describe('bodyLines', () => {
  it('is empty without body findings, so no other prompt changes', () => {
    expect(bodyLines(undefined)).toEqual([])
  })

  it('names the range, tells the verifier to read the head, and says an unanswered one is kept', () => {
    const text = bodyLines({ sha: 'a'.repeat(40), first: 3, count: 2 }).join('\n')
    expect(text).toContain(`earlier review of this pull request at \`${'a'.repeat(40)}\``)
    expect(text).toContain('the 2 input findings from index 3 on')
    expect(text).toContain('never against the since-diff alone')
    expect(text).toContain('neither keep nor drop is kept as posted')
    expect(bodyLines({ sha: null, first: 0, count: 1 }).join('\n')).toContain(
      'earlier review of this pull request posted',
    )
  })
})
