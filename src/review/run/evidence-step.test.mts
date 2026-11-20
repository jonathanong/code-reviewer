import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Finding } from '../finding.mts'
import type { EvidenceSource } from '../rules/evidence-parse.mts'
import { annotateFindings, applyEvidence, type EvidenceStepInput } from './evidence-step.mts'
import type { EvidenceReport } from './evidence-types.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const source = (name: string, env: Record<string, string> = {}): EvidenceSource => ({
  name,
  description: `${name} data.`,
  guide: { file: `/guides/${name}.md` },
  commands: [`${name} logs read`],
  env,
})

const FINDINGS: Finding[] = [
  { pillar: 'correctness', severity: 'high', title: 'Retries loop', body: 'Retries forever.' },
  { pillar: 'design', severity: 'low', title: 'Nit', body: 'Rename it.' },
]

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    type: 'result',
    total_cost_usd: 0.4,
    num_turns: 3,
    structured_output: {
      sources: [
        { name: 'aws', status: 'checked', queries: [{ command: 'aws logs read', result: '0' }] },
      ],
      findings: [{ id: 'F1', effect: 'contradicts', note: 'Never retried in 30 days.' }],
      claims: [],
      ...over,
    },
  })

function setup(
  sources: EvidenceSource[],
  guides: Record<string, string | Error> = {},
  exec = vi.fn(async (..._args: unknown[]) => answer()),
) {
  const out = mkdtempSync(join(tmpdir(), 'evidence-'))
  dirs.push(out)
  const readPrompt = vi.fn(() => 'EVIDENCE prompt text')
  const readGuide = vi.fn(async (guide: { file?: string }) => {
    const found = guides[(guide.file as string).split('/').at(-1)?.replace('.md', '') as string]
    if (found instanceof Error) throw found
    return found ?? 'guide text'
  })
  const input: EvidenceStepInput = {
    setup: async () => ({ sources, readGuide: readGuide as never }),
    readPrompt,
    out,
    title: 'Add retries',
    pullRequestSummary: 'It adds retries.',
    findings: FINDINGS,
    mode: 'full',
    tree: '/tree',
    exec: exec as never,
  }
  const saved = () => JSON.parse(readFileSync(join(out, 'evidence.json'), 'utf8')) as EvidenceReport
  return { input, exec, readPrompt, readGuide, saved, out }
}

describe('applyEvidence', () => {
  it('does nothing and costs nothing when no source is configured', async () => {
    const { input, exec, readPrompt, out } = setup([])
    const outcome = await applyEvidence(input)
    expect(outcome).toEqual({ evidence: undefined, findings: FINDINGS })
    expect(exec).not.toHaveBeenCalled()
    expect(readPrompt).not.toHaveBeenCalled()
    expect(() => readFileSync(join(out, 'evidence.json'))).toThrow()
  })

  it('runs once, saves evidence.json, and appends an evidence line to a supported or contradicted finding', async () => {
    const { input, exec, saved } = setup([source('aws')])
    const { evidence, findings } = await applyEvidence(input)
    expect(exec).toHaveBeenCalledOnce()
    expect(saved()).toEqual(JSON.parse(JSON.stringify(evidence)))
    expect(evidence?.sources.map((entry) => [entry.name, entry.status])).toEqual([
      ['aws', 'checked'],
    ])
    expect(findings[0]).toEqual({
      ...FINDINGS[0],
      body: 'Retries forever.\n\nEvidence (aws, contradicts): Never retried in 30 days.',
    })
    expect(findings[1]).toBe(FINDINGS[1])
    expect(findings.map((finding) => finding.severity)).toEqual(['high', 'low'])
  })

  it('blocks a source whose guide cannot be read, runs the others, and withholds its commands', async () => {
    const { input, exec } = setup([source('dd'), source('aws')], { dd: new Error('ENOENT\nmore') })
    const { evidence } = await applyEvidence(input)
    expect(evidence?.sources).toEqual([
      { name: 'dd', status: 'blocked', reason: 'The guide could not be read: ENOENT', queries: [] },
      expect.objectContaining({ name: 'aws', status: 'checked' }),
    ])
    const args = exec.mock.calls[0]?.[1] as string[]
    expect(args[args.indexOf('--allowedTools') + 1]).toBe('Read,Grep,Glob,Bash(aws logs read:*)')
  })

  it('makes no run when no guide can be read, and lists every source as blocked', async () => {
    const { input, exec, saved } = setup([source('aws')], { aws: new Error('no clone') })
    const { evidence, findings } = await applyEvidence(input)
    expect(exec).not.toHaveBeenCalled()
    expect(evidence).toMatchObject({
      sources: [
        { name: 'aws', status: 'blocked', reason: 'The guide could not be read: no clone' },
      ],
      usage: null,
      failedAttempts: [],
    })
    expect(evidence?.error).toBeUndefined()
    expect(findings).toEqual(FINDINGS)
    expect(saved().sources).toHaveLength(1)
  })

  it('blocks a source whose env sets a name another source set differently, and never reports values', async () => {
    const { input, exec, saved } = setup([
      source('aws', { AWS_PROFILE: 'one-secret', SHARED: 'same' }),
      source('dd', { AWS_PROFILE: 'two-secret', SHARED: 'same' }),
      source('sentry', { SHARED: 'same', OTHER: 'x' }),
    ])
    const { evidence } = await applyEvidence(input)
    expect(evidence?.sources[1]).toEqual({
      name: 'dd',
      status: 'blocked',
      reason:
        'Its env sets AWS_PROFILE differently from source aws, and one run has one environment.',
      queries: [],
    })
    const options = exec.mock.calls[0]?.[2] as { env: Record<string, string> }
    expect(options.env).toEqual({ AWS_PROFILE: 'one-secret', SHARED: 'same', OTHER: 'x' })
    expect(JSON.stringify(saved())).not.toContain('secret')
  })

  it('lists a source the run did not report as blocked', async () => {
    const { input } = setup([source('aws'), source('dd')])
    const { evidence } = await applyEvidence(input)
    expect(evidence?.sources[1]).toEqual({
      name: 'dd',
      status: 'blocked',
      reason: 'The evidence run did not report this source.',
      queries: [],
    })
  })

  it('reports a failed run, keeps every finding, and does not throw', async () => {
    const exec = vi.fn(async () => 'not json')
    const { input, saved } = setup([source('aws')], {}, exec)
    const { evidence, findings } = await applyEvidence(input)
    expect(exec).toHaveBeenCalledTimes(2)
    expect(evidence?.error).toBe('Evidence run did not print JSON.')
    expect(evidence?.failedAttempts).toHaveLength(2)
    expect(findings).toEqual(FINDINGS)
    expect(saved().error).toBe('Evidence run did not print JSON.')
  })

  it('reports a setup failure as an evidence failure', async () => {
    const { input, exec, saved } = setup([source('aws')])
    const { evidence, findings } = await applyEvidence({
      ...input,
      setup: async () => {
        throw new Error('config unreadable\ndetail')
      },
    })
    expect(exec).not.toHaveBeenCalled()
    expect(evidence).toMatchObject({
      error: 'Evidence could not run: config unreadable',
      sources: [],
    })
    expect(findings).toEqual(FINDINGS)
    expect(saved().error).toBe('Evidence could not run: config unreadable')
  })

  it('reports a non-Error failure as text', async () => {
    const { input } = setup([source('aws')])
    const { evidence } = await applyEvidence({
      ...input,
      setup: async () => {
        throw 'plain'
      },
    })
    expect(evidence?.error).toBe('Evidence could not run: plain')
  })

  it('passes the plugin settings through to the run', async () => {
    const { input, exec } = setup([source('aws')])
    await applyEvidence({ ...input, settings: { enabledPlugins: { a: true } } })
    const args = exec.mock.calls[0]?.[1] as string[]
    expect(args[args.indexOf('--settings') + 1]).toBe('{"enabledPlugins":{"a":true}}')
  })
})

describe('annotateFindings', () => {
  const report = (over: Partial<EvidenceReport>): EvidenceReport => ({
    model: 'sonnet',
    sources: [
      { name: 'aws', status: 'checked', queries: [{ command: 'c', result: 'r' }] },
      { name: 'dd', status: 'blocked', reason: 'denied', queries: [] },
    ],
    findings: [],
    claims: [],
    usage: null,
    failedAttempts: [],
    ...over,
  })

  it('names only the checked sources a note rests on', () => {
    const notes = [{ id: 'F1', effect: 'supports' as const, note: 'Seen.', sources: ['aws', 'dd'] }]
    expect(annotateFindings(FINDINGS, report({ findings: notes }))[0]?.body).toBe(
      'Retries forever.\n\nEvidence (aws, supports): Seen.',
    )
  })

  it('leaves a finding alone when the effect is none, the note is empty, or no checked source backs it', () => {
    const notes = [
      { id: 'F1', effect: 'none' as const, note: 'Nothing.' },
      { id: 'F2', effect: 'supports' as const, note: '' },
    ]
    expect(annotateFindings(FINDINGS, report({ findings: notes }))).toEqual(FINDINGS)
    const blockedOnly = [{ id: 'F1', effect: 'supports' as const, note: 'Seen.', sources: ['dd'] }]
    expect(annotateFindings(FINDINGS, report({ findings: blockedOnly }))).toEqual(FINDINGS)
    const unchecked = report({
      sources: [{ name: 'dd', status: 'blocked', reason: 'denied', queries: [] }],
      findings: [{ id: 'F1', effect: 'supports', note: 'Seen.' }],
    })
    expect(annotateFindings(FINDINGS, unchecked)).toEqual(FINDINGS)
  })
})
