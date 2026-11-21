import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, it } from 'vitest'

import { runPillar } from '../benchmark/runner.mts'
import { runVerifier } from '../benchmark/verifier-run.mts'
import { checkFindings } from '../benchmark/verifier-check.mts'
import { judgeFindings } from '../benchmark/judge.mts'
import { applyApprovalCheck } from './approval-check.mts'
import { approvalCheckInput } from './approval-check-prompt.mts'
import { runEvidenceModel } from './evidence-run.mts'
import { runPillars } from './pillars.mts'
import { selectSkills } from './select-skills.mts'
import { runReviewVerifier } from './verify-run.mts'

const references = fileURLToPath(new URL('./fixtures/references', import.meta.url))
const STAGED = fileURLToPath(new URL('../benchmark/fixtures/staged', import.meta.url))
const BARE = fileURLToPath(new URL('../benchmark/fixtures', import.meta.url))
const EXPECTED = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/step-argv.json', import.meta.url)), 'utf8'),
)
const captured: Record<string, unknown> = {}
const out = mkdtempSync(join(tmpdir(), 'cap-'))
const swap = (text: string) =>
  text
    .replaceAll(out, '<OUT>')
    .replaceAll(references, '<REFS>')
    .replaceAll(STAGED, '<STAGED>')
    .replaceAll(BARE, '<BARE>')
let current = ''
const exec = async (...call: unknown[]) => {
  const args = call[1] as string[]
  const prompt = swap(args[1] as string)
  const rest = [...args]
  rest[1] = `sha256:${createHash('sha256').update(prompt).digest('hex')}`
  const whole = JSON.parse(swap(JSON.stringify([call[0], rest, ...call.slice(2)])))
  captured[current] = { arity: call.length, call: whole }
  return JSON.stringify({
    type: 'result',
    structured_output: {
      findings: [],
      skills: [],
      summary: 's',
      pullRequestSummary: 'p',
      verdicts: [],
      matches: [],
      sources: [],
    },
  })
}
const run = async (name: string, fn: () => Promise<unknown>) => {
  current = name
  try {
    await fn()
  } catch {
    // output shape is irrelevant here
  }
}

const settings = { enabledPlugins: { 'skills@m': true } }
const FINDING = {
  pillar: 'design' as const,
  severity: 'high' as const,
  title: 'T',
  body: 'b',
  path: 'a.ts',
}
const item = {
  id: 'c1',
  repo: 'acme/widgets',
  pr: 9,
  title: 'T',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  kind: 'negative',
  reason: '',
  expected: [],
} as never
const web = {
  sources: [
    { name: 'aws', description: 'AWS docs', domains: ['docs.aws.amazon.com', 'a.example.com'] },
  ],
  guidance: 'WEB RULES',
}

afterAll(() => rmSync(out, { recursive: true, force: true }))

// step-argv.json was captured from the code before the harness seam: the whole exec call of
// every step and variant, with prompts as sha256 and temp paths as placeholders.
it('runs every step with the exact claude call', async () => {
  const base = {
    tree: '/tree',
    run: { out, sinceSha: null, hasRules: true },
    contract: 'CONTRACT',
    readPillar: (p: string) => `PILLAR ${p}`,
    skills: ['skills:documentation'],
    jobs: 1,
    exec,
  }
  for (const mode of ['full', 'light'] as const) {
    for (const pillar of ['design', 'history', 'correctness', 'security'] as const) {
      await run(`review.pillar.${pillar}.${mode}.settings`, () =>
        runPillars({ ...base, mode, pillars: [{ pillar, model: 'sonnet' }], settings, web }),
      )
    }
  }
  const contextFile = join(out, 'review-context.md')
  for (const [mode, pillar] of [
    ['full', 'design'],
    ['light', 'correctness'],
  ] as const) {
    await run(`review.pillar.${pillar}.${mode}.settings.context`, () =>
      runPillars({
        ...base,
        mode,
        pillars: [{ pillar, model: 'sonnet' }],
        settings,
        web,
        contextFile,
      }),
    )
  }
  await run('review.pillar.design.full.nosettings', () =>
    runPillars({ ...base, mode: 'full', pillars: [{ pillar: 'design', model: 'opus' }] }),
  )
  await run('review.pillar.correctness.full.noweb', () =>
    runPillars({
      ...base,
      mode: 'full',
      pillars: [{ pillar: 'correctness', model: 'opus' }],
      settings,
    }),
  )
  await run('review.pillar.correctness.full.emptyweb', () =>
    runPillars({
      ...base,
      mode: 'full',
      pillars: [{ pillar: 'correctness', model: 'opus' }],
      web: { sources: [], guidance: 'X' },
    }),
  )

  const vin = {
    verifierPrompt: ' VERIFIER ',
    references: '/refs',
    run: { out: '/run', sinceSha: null, hasRules: true },
    findings: [FINDING],
    skipped: [],
    threads: ['T1'],
  }
  await run('review.verifier.plain', () =>
    runReviewVerifier(vin, { model: 'opus', mode: 'full', tree: '/tree', exec }),
  )
  await run('review.verifier.settings.light', () =>
    runReviewVerifier(vin, { model: 'opus', mode: 'light', tree: '/tree', settings, exec }),
  )
  await run('review.verifier.web', () =>
    runReviewVerifier(
      { ...vin, web },
      { model: 'opus', mode: 'full', tree: '/tree', settings, exec },
    ),
  )

  const skills = [{ name: 'a:b', description: 'd' }]
  await run('review.select.plain', () =>
    selectSkills({ title: 'T', index: '- a.ts', skills, cwd: '/tree', exec }),
  )
  await run('review.select.settings', () =>
    selectSkills({
      title: 'T',
      index: '- a.ts',
      excerpt: 'x',
      skills,
      cwd: '/tree',
      settings,
      exec,
    }),
  )

  const source = (name: string, commands: string[], env: Record<string, string>) => ({
    name,
    description: `${name} data.`,
    guide: { file: '/g.md' },
    commands,
    env,
  })
  const sources = [
    {
      source: source('aws', ['aws logs filter-log-events', 'aws cloudwatch get-metric-data'], {
        AWS_PROFILE: 'p',
      }),
      guide: 'G1',
    },
    {
      source: source('dd', ['dogctl metrics query', 'aws logs filter-log-events'], {
        DD_SITE: 'eu',
      }),
      guide: 'G2',
    },
  ]
  const ein = {
    prompt: 'EVIDENCE',
    title: 'T',
    pullRequestSummary: 'S',
    findings: [FINDING],
    sources,
  }
  const now = () => new Date('2026-01-02T03:04:05Z')
  await run('review.evidence.settings', () =>
    runEvidenceModel(ein, { mode: 'full', tree: '/tree', settings, exec, now }),
  )
  await run('review.evidence.plain.light', () =>
    runEvidenceModel(ein, { mode: 'light', tree: '/tree', exec, now }),
  )

  const output = {
    summary: 's',
    pullRequestSummary: 'p',
    findings: [FINDING],
    questions: [],
    sources: [[0]],
    dropped: new Map(),
    fixedThreadIds: [],
    skills: [],
    usage: { costUsd: 1, turns: 2 },
  } as never
  const ain = {
    ...approvalCheckInput(
      references,
      { out: '/run', sinceSha: null, hasRules: false },
      output,
      [] as never,
      [FINDING],
      [],
    ),
    findings: [],
    questions: [],
  }
  await run('review.approval.settings', () =>
    applyApprovalCheck({
      enabled: true,
      mode: 'full',
      model: 'opus',
      tree: '/tree',
      exec,
      input: ain,
      settings,
    }),
  )
  await run('review.approval.plain', () =>
    applyApprovalCheck({
      enabled: true,
      mode: 'full',
      model: 'opus',
      tree: '/tree',
      exec,
      input: ain,
    }),
  )

  for (const [label, d] of [
    ['rules', STAGED],
    ['bare', BARE],
  ] as const) {
    const pr = (name: string, extra: object) =>
      run(`bench.pillar.${name}.${label}`, () =>
        runPillar(
          item,
          d,
          { pillar: 'design', pillarPrompt: 'Prompt', model: 'opus', maxTurns: 5, ...extra },
          exec,
        ),
      )
    await pr('design', {})
    await pr('control', { skills: false, selected: ['a:b'], settings })
    await pr('history', { pillar: 'history' })
    await pr('history-control', { pillar: 'history', skills: false })
    await pr('correctness', { pillar: 'correctness', settings })
    await run(`bench.verifier.${label}`, () =>
      runVerifier(item, d, [FINDING], { verifierPrompt: 'V', model: 'opus', maxTurns: 9 }, exec),
    )
    await run(`bench.verifier.settings.${label}`, () =>
      runVerifier(
        item,
        d,
        [FINDING],
        { verifierPrompt: 'V', model: 'opus', maxTurns: 9, settings },
        exec,
      ),
    )
    await run(`bench.check.${label}`, () =>
      checkFindings(d, [FINDING], [0], { model: 'opus', maxTurns: 7 }, exec),
    )
    await run(`bench.check.settings.${label}`, () =>
      checkFindings(d, [FINDING], [0], { model: 'opus', maxTurns: 7, settings }, exec),
    )
  }
  const expected = [
    { pillar: 'correctness', severity: 'high', path: 'a.ts', lines: [3, 4], claim: 'c' },
  ] as never
  await run('bench.judge.plain', () => judgeFindings(expected, [FINDING], 'sonnet', exec))
  await run('bench.judge.settings', () =>
    judgeFindings(expected, [FINDING], 'sonnet', exec, settings),
  )
  expect(Object.keys(captured)).toHaveLength(42)
  expect(captured).toStrictEqual(EXPECTED)
})
