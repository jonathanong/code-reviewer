import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import type { Finding } from '../finding.mts'
import { buildVerifierRunPrompt } from '../run/verify.mts'
import { parseEvalCases, type EvalCase } from './cases.mts'
import { defaultExec } from './exec.mts'
import { parseFollowUp, withFixedThreads, type FollowUpCase } from './followup-case.mts'
import { gradeFollowUp } from './followup-grade.mts'
import { followUpBodyInputs, followUpContextText, followUpLines } from './followup-prompt.mts'
import { CONTEXT_DIR, prepareSnapshot } from './snapshot.mts'
import { collectVerifierInput, verifierRunInputs } from './verifier-input.mts'
import { buildVerifierPrompt } from './verifier-prompt.mts'
import { runVerifier, verifierRequest } from './verifier-run.mts'
import { renderVerifierTable, scoreVerifierCase, summarizeVerifier } from './verifier-score.mts'

const CASES_PATH = fileURLToPath(
  new URL('../../../benchmarks/review/followups.json', import.meta.url),
)
const CASES_DIR = fileURLToPath(new URL('../../../benchmarks/review', import.meta.url))
const load = (): EvalCase[] =>
  parseEvalCases(JSON.parse(readFileSync(CASES_PATH, 'utf8')) as unknown, CASES_DIR)
const byId = (id: string): EvalCase => load().find((item) => item.id === id) as EvalCase

function withoutFollowUp(item: EvalCase): EvalCase {
  const { followUp: _followUp, ...rest } = item
  return rest as EvalCase
}

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const valid = {
  previous: {
    sha: 'a'.repeat(40),
    findings: [{ severity: 'high', title: 'T', pillar: 'correctness', path: 'a.ts', line: 3 }],
  },
  unresolved: [
    { threadId: 'T1', severity: 'high', pillar: 'correctness', title: 'T', expect: 'fixed' },
  ],
}

const BODY = {
  severity: 'high',
  pillar: 'correctness',
  title: 'T',
  body: 'Why',
  expect: 'open',
}

function bad(patch: Record<string, unknown>, message: string): void {
  expect(() => parseFollowUp({ ...valid, ...patch }, 'c')).toThrow(message)
}

describe('parseFollowUp', () => {
  it('reads an earlier review, its open threads and held evidence', () => {
    expect(parseFollowUp(undefined, 'c')).toEqual({})
    const held = [{ source: 's', commit: 'c1', status: 'ok', result: 'r' }]
    const { followUp } = parseFollowUp({ ...valid, held }, 'c')
    expect(followUp?.previous).toMatchObject({ sha: 'a'.repeat(40), verdict: null, posted: false })
    expect(followUp?.previous.findings[0]).toMatchObject({ path: 'a.ts', line: 3 })
    expect(followUp?.unresolved[0]).toMatchObject({ threadId: 'T1', path: null, line: null })
    expect(followUp?.held).toEqual(held)
  })

  it('rejects a malformed field with the case path', () => {
    expect(() => parseFollowUp('x', 'c')).toThrow('c: followUp must be an object')
    bad({ unresolved: [] }, 'unresolved or bodyFindings must list at least one earlier finding')
    bad({ unresolved: 'x' }, 'unresolved and bodyFindings must be arrays')
    bad({ bodyFindings: 'x' }, 'unresolved and bodyFindings must be arrays')
    bad({ bodyFindings: [5] }, 'bodyFindings[0]: must be an object')
    bad({ bodyFindings: [{ ...BODY, expect: 'gone' }] }, 'expect must be fixed or open')
    bad({ bodyFindings: [{ ...BODY, body: '' }] }, 'body must be a non-empty string')
    bad({ bodyFindings: [{ ...BODY, severity: 'urgent' }] }, 'is not one the reviewer has')
    bad({ unresolved: [valid.unresolved[0], valid.unresolved[0]] }, 'threadIds must be unique')
    bad({ unresolved: [5] }, 'unresolved[0]: must be an object')
    bad(
      { unresolved: [{ ...valid.unresolved[0], expect: 'gone' }] },
      'expect must be fixed or open',
    )
    bad({ unresolved: [{ ...valid.unresolved[0], line: 0 }] }, 'line must be a positive integer')
    bad({ unresolved: [{ ...valid.unresolved[0], title: '' }] }, 'title must be a non-empty string')
    bad({ previous: 'x' }, 'previous must be an object')
    bad({ previous: { sha: 'a' } }, 'previous.findings must be an array')
    bad({ previous: { sha: 'a', findings: [1] } }, 'previous.findings[0]: must be an object')
    bad({ previous: { sha: '', findings: [] } }, 'sha must be a non-empty string')
    bad({ held: 'x' }, 'held must be an array')
    bad({ held: [1] }, 'held[0]: must be an object')
    bad({ held: [{ source: 's' }] }, 'commit must be a non-empty string')
  })

  it('needs a fixture case, which holds the reviewed tree', () => {
    const repo = {
      id: 'r',
      repo: 'a/b',
      pr: 1,
      baseSha: 'a'.repeat(40),
      headSha: 'b'.repeat(40),
      title: 'T',
      kind: 'negative',
      expected: [],
      followUp: valid,
    }
    expect(() => parseEvalCases([repo])).toThrow('followUp needs a fixture case')
  })
})

describe('the follow-up cases', () => {
  it('parse, each with a labeled thread and its reviewed tree', () => {
    const cases = load()
    expect(cases.map((item) => item.id)).toEqual([
      'followup-fixed',
      'followup-still-present',
      'followup-fixed-new-defect',
      'followup-mixed',
      'followup-body-open',
      'followup-body-fixed',
    ])
    expect(cases.map((item) => item.followUp?.unresolved.map((entry) => entry.expect))).toEqual([
      ['fixed'],
      ['open'],
      ['fixed'],
      ['fixed', 'open'],
      [],
      [],
    ])
    expect(
      cases.flatMap((item) => item.followUp?.bodyFindings?.map((e) => e.expect) ?? []),
    ).toEqual(['open', 'fixed'])
    expect(cases.map((item) => item.kind)).toEqual([
      'negative',
      'negative',
      'positive',
      'negative',
      'negative',
      'negative',
    ])
  })
})

describe('the prompt a follow-up case builds', () => {
  const followUp = byId('followup-mixed').followUp as FollowUpCase

  it('uses the lines a live follow-up verifier run is given', () => {
    const lines = followUpLines(followUp, CONTEXT_DIR)
    const live = buildVerifierRunPrompt({
      verifierPrompt: 'V',
      references: '/refs',
      run: { out: CONTEXT_DIR, sinceSha: followUp.previous.sha, hasRules: false },
      findings: [],
      skipped: [],
      threads: [],
      previous: followUp.previous,
      heldEvidence: followUp.held ?? [],
      now: new Date('2026-11-27T00:00:00Z'),
    })
    // Every block the benchmark adds is in the live prompt, byte for byte.
    for (const line of lines) expect(live).toContain(line)
    expect(lines.join('\n')).toContain('## Your earlier review of this pull request')
  })

  it('adds the blocks and the fixedThreadIds schema field only for a follow-up case', () => {
    const item = byId('followup-mixed')
    const prompt = buildVerifierPrompt('V', item, [], false, undefined, undefined, followUp)
    expect(prompt).toContain('`fixedThreadIds` lists the thread ids')
    expect(prompt.indexOf('## Your earlier review')).toBeLessThan(
      prompt.indexOf('## Pillar findings'),
    )
    expect(buildVerifierPrompt('V', item, [])).not.toContain('earlier review')
    const request = verifierRequest(prompt, 'm', 5, false, undefined, undefined, followUp)
    expect((request.schema as { properties: object }).properties).toHaveProperty('fixedThreadIds')
    expect(
      (verifierRequest(prompt, 'm', 5).schema as { properties: object }).properties,
    ).not.toHaveProperty('fixedThreadIds')
  })

  it('renders context.md with the thread ids the verifier may report fixed', () => {
    const text = followUpContextText(followUp, 'T', 'Description')
    expect(text).toContain('thread `PRRT_followupMixedA1`')
    expect(text).toContain('thread `PRRT_followupMixedB2`')
    expect(text).toContain('> Description')
    expect(text).toContain('Last review: `444444444444`')
  })
})

describe('withFixedThreads', () => {
  it('leaves the schema alone without a follow-up', () => {
    const schema = { properties: { a: 1 } }
    expect(withFixedThreads(schema, undefined)).toBe(schema)
  })
})

describe('gradeFollowUp', () => {
  const mixed = byId('followup-mixed').followUp as FollowUpCase

  it('passes a thread whose fixed state matches its label, and ignores unlisted ids', () => {
    const graded = gradeFollowUp(mixed, ['PRRT_followupMixedA1', 'made-up'])
    expect(graded.threads.map((entry) => entry.passed)).toEqual([true, true])
  })

  it('fails a fixed thread left out and an open thread reported fixed', () => {
    expect(gradeFollowUp(mixed, []).threads.map((entry) => entry.passed)).toEqual([false, true])
    expect(
      gradeFollowUp(mixed, ['PRRT_followupMixedA1', 'PRRT_followupMixedB2']).threads.map(
        (entry) => entry.passed,
      ),
    ).toEqual([true, false])
    expect(gradeFollowUp(mixed, 'nope').threads.map((entry) => entry.fixed)).toEqual([false, false])
  })
})

describe('staging a follow-up fixture', () => {
  it('writes the since-diff from the reviewed tree and the follow-up context.md', async () => {
    const work = mkdtempSync(join(tmpdir(), 'followup-'))
    dirs.push(work)
    const item = byId('followup-fixed')
    const snapshot = await prepareSnapshot(
      item,
      join(work, 'cache'),
      join(work, 'work'),
      defaultExec,
    )
    const read = (name: string) => readFileSync(join(snapshot.dir, CONTEXT_DIR, name), 'utf8')
    const since = read('since.patch')
    expect(since).toContain('+  const bounded = Math.min(Math.max(percent, 0), 100)')
    expect(since).not.toMatch(/(?:base|reviewed|head)\//u)
    expect(read('since/INDEX.md')).toContain('src/discount.mts')
    expect(read('context.md')).toContain('thread `PRRT_followupFixed01`')
    // The whole pull request diff is still the base to head diff.
    expect(read('diff.patch')).toContain('src/catalog.mts')
  })

  it('stages no since-diff for a case that is not a follow-up', async () => {
    const work = mkdtempSync(join(tmpdir(), 'followup-'))
    dirs.push(work)
    const plain = withoutFollowUp(byId('followup-fixed'))
    const snapshot = await prepareSnapshot(
      plain,
      join(work, 'cache'),
      join(work, 'work'),
      defaultExec,
    )
    expect(() => readFileSync(join(snapshot.dir, CONTEXT_DIR, 'since.patch'))).toThrow()
  })
})

describe('verifier input and results for a follow-up case', () => {
  const none = { readFile: () => '', exists: () => false }

  it('runs the verifier alone, with no pillar findings, and keys saved output by the follow-up', () => {
    const item = byId('followup-fixed')
    const input = collectVerifierInput(item, '/x', 'j', none)
    expect(input).toEqual({ findings: [], real: [], planted: [] })
    const run = { verifierPrompt: 'V', model: 'm', maxTurns: 1 }
    const changed = {
      ...item,
      followUp: { ...(item.followUp as FollowUpCase), held: [] },
    } as EvalCase
    expect(verifierRunInputs(changed, input!, run, 'r')).not.toBe(
      verifierRunInputs(item, input!, run, 'r'),
    )
  })

  it('grades fixedThreadIds from the structured output and counts them in the summary', async () => {
    const item = byId('followup-mixed')
    const exec = async () =>
      JSON.stringify({
        structured_output: { summary: 's', findings: [], fixedThreadIds: ['PRRT_followupMixedA1'] },
      })
    const result = await runVerifier(
      item,
      '/snap',
      [],
      { verifierPrompt: 'V', model: 'm', maxTurns: 1 },
      exec,
    )
    expect(result.followUp?.threads.map((entry) => entry.passed)).toEqual([true, true])
    const graded = { judge: 'j', checker: 'k', inputs: 'i', added: [], checks: [] }
    const input = { findings: [], real: [], planted: [] }
    const scored = scoreVerifierCase(item, input, result.output, graded, undefined, result.followUp)
    const summary = summarizeVerifier([scored])
    expect([summary.earlier, summary.earlierPassed]).toEqual([2, 2])
    expect(renderVerifierTable(summary)).toContain('Earlier findings of follow-ups: 2 of 2')
    const plain = summarizeVerifier([scoreVerifierCase(item, input, result.output, graded)])
    expect(renderVerifierTable(plain)).not.toContain('Earlier findings of follow-ups')
  })

  it('reports no follow-up grade for a case without one', async () => {
    const item = withoutFollowUp(byId('followup-fixed'))
    const exec = async () => JSON.stringify({ structured_output: { summary: 's', findings: [] } })
    const result = await runVerifier(
      item,
      '/snap',
      [],
      { verifierPrompt: 'V', model: 'm', maxTurns: 1 },
      exec,
    )
    expect(result).not.toHaveProperty('followUp')
  })
})

describe('a follow-up case with a finding that has no thread', () => {
  const open = byId('followup-body-open')
  const fixed = byId('followup-body-fixed')
  const followUp = open.followUp as FollowUpCase

  it('needs no thread, and lists the finding as an input after the pillars', () => {
    expect(
      parseFollowUp({ ...valid, unresolved: undefined, bodyFindings: [BODY] }, 'c'),
    ).toMatchObject({
      followUp: { unresolved: [], bodyFindings: [{ threadId: null, line: null, body: 'Why' }] },
    })
    expect(followUpBodyInputs(followUp)).toMatchObject([
      { severity: 'high', path: 'src/rules/mock-capture.mts', line: 8 },
    ])
    expect(followUpBodyInputs(undefined)).toEqual([])
  })

  it('puts the finding in the prompt at the index after the pillar findings, and in context.md', () => {
    const own: Finding[] = [{ pillar: 'rules', severity: 'low', title: 'Own', body: 'b' }]
    const prompt = buildVerifierPrompt('V', open, own, false, undefined, undefined, followUp)
    expect(prompt).toContain('the 1 input findings from index 1 on')
    expect(prompt).toContain('"index": 1')
    expect(followUpContextText(followUp, 'T', 'D')).toContain('no thread (review body)')
    expect(buildVerifierPrompt('V', open, own)).not.toContain('no thread')
  })

  it('uses the lines a live follow-up verifier run is given for those findings', () => {
    const own: Finding[] = [{ pillar: 'rules', severity: 'low', title: 'Own', body: 'b' }]
    const input = {
      verifierPrompt: 'V',
      references: '/refs',
      run: { out: CONTEXT_DIR, sinceSha: followUp.previous.sha, hasRules: false },
      findings: [...own, ...followUpBodyInputs(followUp)],
      skipped: [],
      threads: [],
      previous: followUp.previous,
      now: new Date('2026-11-27T00:00:00Z'),
    }
    const live = buildVerifierRunPrompt({
      ...input,
      bodyFindings: { sha: followUp.previous.sha, first: 1, count: 1 },
    })
    for (const line of followUpLines(followUp, CONTEXT_DIR, 1)) expect(live).toContain(line)
    expect(live).toContain('## Your earlier findings that have no thread')
    expect(buildVerifierRunPrompt(input)).not.toContain('no thread')
  })

  it('asks for a reason in `dropped` only when the case has such a finding', () => {
    const withBody = withFixedThreads({ properties: {} }, followUp).properties
    expect(withBody).toHaveProperty('dropped')
    expect(
      withFixedThreads({ properties: {} }, byId('followup-fixed').followUp).properties,
    ).not.toHaveProperty('dropped')
  })

  it('grades a finding kept as open, and one dropped with a reason as fixed', () => {
    const kept = { first: 0, sources: [[0]], dropped: new Map<number, string>() }
    const dropped = { first: 0, sources: [], dropped: new Map([[0, 'The head unwraps it.']]) }
    const none = { first: 0, sources: [], dropped: new Map<number, string>() }
    const passed = (item: EvalCase, answers: Parameters<typeof gradeFollowUp>[2]) =>
      gradeFollowUp(item.followUp as FollowUpCase, [], answers).threads.map((entry) => entry.passed)
    expect(passed(open, kept)).toEqual([true])
    expect(passed(open, dropped)).toEqual([false])
    // A finding the verifier says nothing about is kept by `review`, so it is open here too.
    expect(passed(open, none)).toEqual([true])
    expect(passed(fixed, dropped)).toEqual([true])
    expect(passed(fixed, kept)).toEqual([false])
    expect(passed(fixed, none)).toEqual([false])
    expect(passed(open, undefined)).toEqual([true])
    expect(gradeFollowUp(followUp, [], dropped).threads[0]?.thread).toBe('body:0')
  })
})
