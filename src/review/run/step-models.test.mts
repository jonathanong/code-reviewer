import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

import { resolveModelPlan } from '../models.mts'
import { applyApprovalCheck } from './approval-check.mts'
import { approvalCheckInput } from './approval-check-prompt.mts'
import { runEvidenceModel } from './evidence-run.mts'
import { applyEvidence } from './evidence-step.mts'
import { fallbackModels, limitedExec, modelsOf, noModels } from './fallback-fake-io.mts'
import { runPillars } from './pillars.mts'
import { selectSkills } from './select-skills.mts'
import { runReviewVerifier } from './verify-run.mts'

const references = fileURLToPath(new URL('./fixtures/references', import.meta.url))
const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})
const tmp = () => {
  const dir = mkdtempSync(join(tmpdir(), 'step-models-'))
  dirs.push(dir)
  return dir
}

const answer = (structured: unknown) =>
  JSON.stringify({ type: 'result', total_cost_usd: 0.25, structured_output: structured })

const RAN_B = { harness: 'claude', model: 'b', waitedMs: 0 }

describe('skill selection', () => {
  const input = {
    title: 'T',
    index: '- a.ts',
    skills: [{ name: 'p:a', description: 'A' }],
    cwd: '/tree',
  }

  it('falls back to the next model of the select step and records it', async () => {
    const exec = limitedExec(answer({ skills: ['p:a'] }), ['a'])
    const choice = await selectSkills({ ...input, models: fallbackModels('select'), exec })
    expect(modelsOf(exec)).toEqual(['a', 'b'])
    expect(choice).toMatchObject({ selected: ['p:a'], ran: RAN_B })
  })

  it('records the model that failed when every candidate does', async () => {
    const exec = limitedExec('', ['a', 'b'])
    const choice = await selectSkills({ ...input, models: fallbackModels('select'), exec })
    expect(choice.error).toContain('claude exited with 1')
    expect(choice.ran).toEqual(RAN_B)
  })

  it('records the model of a run that returned no skills', async () => {
    const exec = limitedExec(answer({ nope: 1 }), [])
    const choice = await selectSkills({ ...input, models: fallbackModels('select'), exec })
    expect(choice).toMatchObject({ error: 'No skills returned.', ran: { model: 'a' } })
  })
})

describe('pillars', () => {
  function pillarInput(exec: ReturnType<typeof limitedExec>, step: string) {
    const out = tmp()
    return {
      out,
      input: {
        pillars: [
          { pillar: 'rules' as const, model: 'sonnet' as const },
          { pillar: 'design' as const, model: 'sonnet' as const },
        ],
        tree: '/tree',
        run: { out, sinceSha: null, hasRules: true },
        mode: 'full' as const,
        jobs: 1,
        contract: 'C',
        readPillar: (pillar: string) => `PILLAR ${pillar}`,
        skills: [],
        models: fallbackModels(step),
        exec,
      },
    }
  }

  it('runs a pillar on the first model its step lists, then the next on a rate limit', async () => {
    const exec = limitedExec(answer({ findings: [] }), ['a'])
    const { out, input } = pillarInput(exec, 'pillar.design')
    const results = await runPillars(input)
    // `rules` has no setting and keeps its planned model; `design` fell back from a to b.
    expect(results.map((result) => [result.pillar, result.model])).toEqual([
      ['rules', 'sonnet'],
      ['design', 'b'],
    ])
    expect(results[1]?.ran).toEqual(RAN_B)
    expect(modelsOf(exec)).toEqual(['sonnet', 'a', 'b'])
    const saved = JSON.parse(readFileSync(join(out, 'pillars', 'design.json'), 'utf8'))
    expect(saved).toMatchObject({ model: 'b', ran: RAN_B })
  })

  it('lets the pillars step set every pillar without its own setting', async () => {
    const exec = limitedExec(answer({ findings: [] }), [])
    const { input } = pillarInput(exec, 'pillars')
    await runPillars(input)
    expect(modelsOf(exec)).toEqual(['a', 'a'])
  })

  it('reports the model that failed last when a pillar fails twice', async () => {
    const exec = limitedExec('', ['a', 'b'])
    const { input } = pillarInput(exec, 'pillars')
    const results = await runPillars(input)
    expect(results[0]).toMatchObject({ model: 'b', ran: RAN_B })
    expect(results[0]?.error).toContain('claude exited with 1')
    expect(results[0]?.failedAttempts).toHaveLength(2)
  })
})

describe('verifier', () => {
  const input = {
    verifierPrompt: 'V',
    references: '/refs',
    run: { out: '/run', sinceSha: null, hasRules: true },
    findings: [],
    skipped: [],
    threads: [],
  }
  const reply = answer({ summary: 's', pullRequestSummary: 'p', findings: [] })

  it('runs the full verifier on the verifier step and a light one on verifier.light', async () => {
    const full = limitedExec(reply, ['a'])
    const out = await runReviewVerifier(input, {
      model: 'opus',
      mode: 'full',
      tree: '/t',
      models: fallbackModels('verifier'),
      exec: full,
    })
    expect(modelsOf(full)).toEqual(['a', 'b'])
    expect(out.ran).toEqual(RAN_B)

    const light = limitedExec(reply, [])
    await runReviewVerifier(input, {
      model: 'sonnet',
      mode: 'light',
      tree: '/t',
      models: fallbackModels('verifier.light'),
      exec: light,
    })
    expect(modelsOf(light)).toEqual(['a'])
  })

  it('takes the planned model as the tier when the step is not set', async () => {
    const exec = limitedExec(reply, [])
    const models = {
      plan: resolveModelPlan({ tiers: { large: [{ harness: 'claude', model: 'z' }] } }),
    }
    await runReviewVerifier(input, { model: 'opus', mode: 'full', tree: '/t', models, exec })
    await runReviewVerifier(input, { model: 'sonnet', mode: 'light', tree: '/t', models, exec })
    expect(modelsOf(exec)).toEqual(['z', 'sonnet'])
  })
})

describe('evidence', () => {
  const source = {
    name: 'aws',
    description: 'AWS.',
    guide: { file: '/g.md' },
    commands: ['aws logs'],
    env: {},
  }
  const input = {
    prompt: 'E',
    title: 'T',
    pullRequestSummary: 's',
    findings: [],
    sources: [{ source, guide: 'g' }],
  }
  const reply = answer({
    sources: [{ name: 'aws', status: 'checked', queries: [{ command: 'aws logs', result: '0' }] }],
    findings: [],
    claims: [],
  })

  it('runs on the evidence step and records the model', async () => {
    const exec = limitedExec(reply, ['a'])
    const run = await runEvidenceModel(input, {
      mode: 'full',
      tree: '/t',
      models: fallbackModels('evidence'),
      exec,
    })
    expect(modelsOf(exec)).toEqual(['a', 'b'])
    expect(run).toMatchObject({ ran: RAN_B })
  })

  it('names the last model tried when the run fails twice', async () => {
    const exec = limitedExec('', ['a', 'b'])
    const run = await runEvidenceModel(input, {
      mode: 'full',
      tree: '/t',
      models: fallbackModels('evidence'),
      exec,
    })
    expect(run).toMatchObject({ ran: RAN_B })
    expect('error' in run).toBe(true)
  })

  it('puts the model that ran in the evidence report, answered or failed', async () => {
    const step = (exec: ReturnType<typeof limitedExec>) => ({
      setup: async () => ({ sources: [source], readGuide: async () => 'g' }),
      readPrompt: () => 'E',
      out: tmp(),
      title: 'T',
      pullRequestSummary: 's',
      findings: [],
      mode: 'full' as const,
      tree: '/t',
      models: fallbackModels('evidence'),
      exec,
    })
    const answered = await applyEvidence(step(limitedExec(reply, ['a'])))
    expect(answered.evidence).toMatchObject({ model: 'b', ran: RAN_B })
    const failed = await applyEvidence(step(limitedExec('', ['a', 'b'])))
    expect(failed.evidence).toMatchObject({ model: 'b', ran: RAN_B })
    expect(failed.evidence?.error).toContain('claude exited with 1')
  })
})

describe('approval check', () => {
  const run = { out: '/run', sinceSha: null, hasRules: false }
  const output = { summary: 's', findings: [], questions: [], sources: [], dropped: new Map() }
  const step = (exec: ReturnType<typeof limitedExec>) => ({
    enabled: true,
    mode: 'full' as const,
    model: 'opus' as const,
    tree: '/tree',
    models: fallbackModels('approvalCheck'),
    exec,
    input: approvalCheckInput(references, run, output as never, [], [], []),
  })

  it('runs on the approvalCheck step and records the model', async () => {
    const exec = limitedExec(answer({ summary: 'Holds.', findings: [] }), ['a'])
    const { check } = await applyApprovalCheck(step(exec))
    expect(modelsOf(exec)).toEqual(['a', 'b'])
    expect(check).toMatchObject({ model: 'b', ran: RAN_B, outcome: 'upheld' })
  })

  it('records the model that failed when the check cannot complete', async () => {
    const { check } = await applyApprovalCheck(step(limitedExec('', ['a', 'b'])))
    expect(check).toMatchObject({ model: 'b', ran: RAN_B, outcome: 'failed' })
  })
})

describe('a step with no model to ask', () => {
  const never = limitedExec('', [])

  it('fails each step without a model record, and asks nothing', async () => {
    const choice = await selectSkills({
      title: 'T',
      index: '',
      skills: [{ name: 'p:a', description: 'A' }],
      cwd: '/t',
      models: noModels('select'),
      exec: never,
    })
    expect(choice.error).toContain('at least one model')
    expect(choice.ran).toBeUndefined()

    const pillars = await runPillars({
      pillars: [{ pillar: 'rules', model: 'sonnet' }],
      tree: '/t',
      run: { out: tmp(), sinceSha: null, hasRules: true },
      mode: 'full',
      jobs: 1,
      contract: 'C',
      readPillar: () => 'P',
      skills: [],
      models: noModels('pillars'),
      exec: never,
    })
    expect(pillars[0]).toMatchObject({ model: 'sonnet' })
    expect(pillars[0]?.ran).toBeUndefined()

    const evidence = await runEvidenceModel(
      { prompt: 'E', title: 'T', pullRequestSummary: 's', findings: [], sources: [] },
      { mode: 'full', tree: '/t', models: noModels('evidence'), exec: never },
    )
    expect('error' in evidence && evidence.ran).toBeUndefined()
    expect(never).not.toHaveBeenCalled()
  })

  it('names the planned model when the approval check or the evidence report cannot start', async () => {
    const run = { out: '/run', sinceSha: null, hasRules: false }
    const output = { summary: 's', findings: [], questions: [], sources: [], dropped: new Map() }
    const { check } = await applyApprovalCheck({
      enabled: true,
      mode: 'full',
      model: 'opus',
      tree: '/tree',
      models: noModels('approvalCheck'),
      exec: never,
      input: approvalCheckInput(references, run, output as never, [], [], []),
    })
    expect(check).toMatchObject({ model: 'opus', outcome: 'failed' })
    expect(check?.ran).toBeUndefined()

    const source = {
      name: 'aws',
      description: 'A',
      guide: { file: '/g.md' },
      commands: ['aws'],
      env: {},
    }
    const applied = await applyEvidence({
      setup: async () => ({ sources: [source], readGuide: async () => 'g' }),
      readPrompt: () => 'E',
      out: tmp(),
      title: 'T',
      pullRequestSummary: 's',
      findings: [],
      mode: 'full',
      tree: '/t',
      models: noModels('evidence'),
      exec: never,
    })
    expect(applied.evidence?.error).toContain('at least one model')
    expect(applied.evidence?.ran).toBeUndefined()
  })
})
