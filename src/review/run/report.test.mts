import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseUsage } from '../../harness/claude-usage.mts'
import type { Finding } from '../finding.mts'
import { buildReport, costBreakdown, flattenFindings, type ReportInput } from './report.mts'
import { rerenderReport, writeReportFiles } from './report-file.mts'
import { renderReport } from './report-render.mts'
import type { EvidenceReport } from './evidence-types.mts'
import type { PillarResult } from './types.mts'
import type { ReviewVerifierOutput } from './verify.mts'

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const usage = (costUsd: number, turns: number) =>
  parseUsage({ total_cost_usd: costUsd, num_turns: turns })

const kept: Finding = {
  pillar: 'correctness',
  severity: 'high',
  title: 'Off by one',
  body: 'Line one.\nLine two.',
  path: 'a.ts',
  line: 9,
  side: 'RIGHT',
  startLine: 7,
}
const noisy: Finding = { pillar: 'correctness', severity: 'low', title: 'Naming', body: 'nit' }
const unexplained: Finding = {
  pillar: 'design',
  severity: 'medium',
  title: 'Layering',
  body: 'b',
  path: 'b.ts',
}

const PILLARS: PillarResult[] = [
  {
    pillar: 'correctness',
    model: 'sonnet',
    skills: ['skills:typescript-authoring'],
    findings: [kept, noisy],
    usage: usage(0.25, 6),
    failedAttempts: [{ error: 'boom', usage: usage(0.05, 1) }],
  },
  {
    pillar: 'design',
    model: 'sonnet',
    skills: [],
    findings: [unexplained],
    usage: usage(0.1, 3),
    failedAttempts: [],
  },
  { pillar: 'rules', model: 'sonnet', skills: [], findings: [], usage: null, failedAttempts: [] },
  {
    pillar: 'history',
    model: 'haiku',
    skills: [],
    findings: [],
    usage: null,
    error: 'Pillar run did not print JSON.',
    failedAttempts: [
      { error: 'Pillar run did not print JSON.', usage: usage(0.02, 1) },
      { error: 'Pillar run did not print JSON.', usage: null },
    ],
  },
]

const OUTPUT: ReviewVerifierOutput = {
  summary: 'One thing to fix.',
  pullRequestSummary: 'It adds a widget.',
  findings: [kept],
  sources: [[0]],
  dropped: new Map([[1, 'Style only.']]),
  questions: [],
  fixedThreadIds: [],
  dependencies: [],
  skills: [],
  usage: usage(1.5, 12),
}

const INPUT: ReportInput = {
  repo: 'acme/widgets',
  pr: 4,
  title: 'Add widget',
  headSha: 'a'.repeat(40),
  mode: 'full',
  effort: 'high',
  reasons: ['Security trigger: auth.ts.'],
  verdict: 'Comment',
  skipped: [{ pillar: 'security', reason: 'No security trigger paths changed.' }],
  skillSelection: {
    selected: ['skills:typescript-authoring'],
    available: 3,
    usage: usage(0.01, 1),
  },
  pillars: PILLARS,
  verifier: { model: 'opus', output: OUTPUT },
}

describe('buildReport', () => {
  const data = buildReport(INPUT)

  it('marks each raw finding kept or dropped by the verifier, with its reason', () => {
    const flags = data.pillars.flatMap((pillar) =>
      pillar.findings.map((finding) => [finding.title, finding.dropped, finding.droppedReason]),
    )
    expect(flags).toEqual([
      ['Off by one', false, undefined],
      ['Naming', true, 'Style only.'],
      ['Layering', true, undefined],
    ])
    expect(flattenFindings(PILLARS)).toEqual([kept, noisy, unexplained])
  })

  it('carries the verified findings, summaries, and the pull request link', () => {
    expect(data).toMatchObject({
      version: 1,
      url: 'https://github.com/acme/widgets/pull/4',
      pullRequestSummary: 'It adds a widget.',
      summary: 'One thing to fix.',
      verdict: 'Comment',
      findings: [kept],
      verifier: { model: 'opus', usage: OUTPUT.usage },
    })
  })

  it('totals selection, pillars with failed attempts, and the verifier', () => {
    const cost = costBreakdown(data)
    expect(cost.selection).toBeCloseTo(0.01)
    expect(cost.pillars).toBeCloseTo(0.25 + 0.05 + 0.1 + 0.02)
    expect(cost.verifier).toBeCloseTo(1.5)
    expect(cost.total).toBeCloseTo(1.93)
  })

  it('builds a skipped review with no verifier', () => {
    const skipped = buildReport({
      ...INPUT,
      mode: 'skip',
      skipReason: 'Dependabot lockfile bump.',
      verdict: null,
      pillars: [],
      verifier: undefined,
      skillSelection: { selected: [], available: 0, usage: null },
    })
    expect(skipped).toMatchObject({
      skipReason: 'Dependabot lockfile bump.',
      verifier: null,
      findings: [],
    })
    expect(costBreakdown(skipped).total).toBe(0)
  })

  it('treats every raw finding as kept when there is no verifier output', () => {
    const none = buildReport({ ...INPUT, verifier: undefined })
    expect(none.pillars[0]?.findings.every((finding) => !finding.dropped)).toBe(true)
  })
})

describe('usage by model', () => {
  const withModels = (model: string, costUsd: number, output: number) =>
    parseUsage({
      total_cost_usd: costUsd,
      modelUsage: { [model]: { inputTokens: 10, outputTokens: output, costUSD: costUsd } },
    })

  const input: ReportInput = {
    ...INPUT,
    skillSelection: { selected: [], available: 1, usage: withModels('haiku', 0.01, 1) },
    pillars: [
      {
        ...(PILLARS[0] as PillarResult),
        usage: withModels('sonnet', 0.25, 5),
        failedAttempts: [{ error: 'boom', usage: withModels('sonnet', 0.05, 2) }],
      },
      { ...(PILLARS[2] as PillarResult), usage: null },
    ],
    verifier: { model: 'opus', output: { ...OUTPUT, usage: withModels('opus', 1.5, 9) } },
  }

  it('totals tokens and cost per model for each step, failed attempts included', () => {
    const data = buildReport(input)
    expect(data.usageByModel.map((step) => step.name)).toEqual(['selection', 'pillars', 'verifier'])
    expect(data.usageByModel[1]?.models).toEqual([
      { model: 'sonnet', runs: 2, inputTokens: 20, outputTokens: 7, costUsd: 0.3 },
    ])
    expect(renderReport(data)).toContain('| pillars | sonnet | 2 | 20 | 7 | $0.30 |')
    expect(renderReport(data)).toContain('| all | opus | 1 | 10 | 9 | $1.50 |')
    expect(renderReport(data)).toContain('### Tokens by model')
    expect(renderReport(data)).not.toContain('Fixed since the last review')
    const fixed = buildReport({
      ...INPUT,
      verifier: { model: 'opus', output: { ...OUTPUT, fixedThreadIds: ['T1', 'T2'] } },
    })
    expect(renderReport(fixed)).toContain(
      'run `code-reviewer resolve --repo acme/widgets --pr 4 --thread T1 T2`',
    )
  })

  it('has no models for a review whose usage lacks them', () => {
    expect(buildReport(INPUT).usageByModel.flatMap((step) => step.models)).toEqual([])
  })
})

const EVIDENCE: EvidenceReport = {
  model: 'sonnet',
  sources: [
    {
      name: 'aws',
      status: 'checked',
      queries: [
        {
          command: 'aws logs x',
          result: '0 events',
          control: { command: 'aws logs y', result: '12 events' },
        },
      ],
    },
    { name: 'dd', status: 'blocked', reason: 'AccessDenied', queries: [] },
  ],
  findings: [{ id: 'F1', effect: 'contradicts', note: 'Never seen.' }],
  claims: [{ claim: 'Called daily', effect: 'supports', note: '' }],
  usage: usage(0.5, 4),
  failedAttempts: [
    { error: 'bad', usage: usage(0.1, 1) },
    { error: 'crash', usage: null },
  ],
}

describe('evidence in the report', () => {
  const data = buildReport({ ...INPUT, evidence: EVIDENCE })

  it('adds the evidence run and its failed attempts to the cost', () => {
    expect(costBreakdown(data).evidence).toBeCloseTo(0.6)
    expect(costBreakdown(data).total).toBeCloseTo(costBreakdown(buildReport(INPUT)).total + 0.6)
    expect(data.usageByModel.map((step) => step.name)).toContain('evidence')
    expect(data.evidence).toBe(EVIDENCE)
  })

  it('renders each source, query with control, finding note, and claim', () => {
    const text = renderReport(data)
    expect(text).toContain('### Evidence')
    expect(text).toContain('#### aws: checked')
    expect(text).toContain('Query `aws logs x`\n\n> 0 events')
    expect(text).toContain('Control `aws logs y`\n\n> 12 events')
    expect(text).toContain('#### dd: blocked\n\nAccessDenied')
    expect(text).toContain('- F1 Off by one: contradicts. Never seen.')
    expect(text).toContain('- `Called daily`: supports\n')
    expect(
      renderReport(
        buildReport({
          ...INPUT,
          evidence: {
            ...EVIDENCE,
            claims: [{ claim: 'Rare', effect: 'contradicts', note: 'Seen twice.' }],
          },
        }),
      ),
    ).toContain('- `Rare`: contradicts. Seen twice.')
    expect(text).toContain('including 2 failed attempt(s)')
    expect(text).toContain(', evidence $0.6000)')
  })

  it('says no run was made, and shows a failure, an empty result, and a backtick safely', () => {
    const idle: EvidenceReport = {
      ...EVIDENCE,
      usage: null,
      failedAttempts: [],
      error: 'it broke',
      sources: [
        {
          name: 'aws',
          status: 'checked',
          queries: [{ command: 'echo `x`', result: '' }],
        },
      ],
      findings: [],
      claims: [],
    }
    const text = renderReport(buildReport({ ...INPUT, evidence: idle }))
    expect(text).toContain('No evidence run was made.')
    expect(text).toContain('Failed: it broke')
    expect(text).toContain("Query `echo 'x'`\n\n> (empty)")
    expect(text).not.toContain('Findings:\n- F')
  })

  it('omits the failed-attempt count for a clean run and the note for a bare finding', () => {
    const clean: EvidenceReport = {
      ...EVIDENCE,
      failedAttempts: [],
      findings: [{ id: 'F1', effect: 'none', note: '' }],
    }
    const text = renderReport(buildReport({ ...INPUT, evidence: clean }))
    expect(text).toContain('Run: sonnet, $0.5000.')
    expect(text).toContain('- F1 Off by one: none\n')
  })

  it('reports a run whose attempts all failed as a run, not as no run', () => {
    const failed: EvidenceReport = { ...EVIDENCE, usage: null, error: 'both failed' }
    const text = renderReport(buildReport({ ...INPUT, evidence: failed }))
    expect(text).not.toContain('No evidence run was made.')
    expect(text).toContain('including 2 failed attempt(s)')
  })

  it('shows no evidence section or cost without evidence', () => {
    expect(renderReport(buildReport(INPUT))).not.toContain('Evidence')
    expect(costBreakdown(buildReport(INPUT)).evidence).toBe(0)
  })
})

describe('renderReport', () => {
  const markdown = renderReport(buildReport(INPUT))

  it('opens with the heading, link, mode, effort, and reasons', () => {
    expect(markdown.startsWith('## acme/widgets#4: Add widget\n')).toBe(true)
    expect(markdown).toContain(
      '[https://github.com/acme/widgets/pull/4](https://github.com/acme/widgets/pull/4)',
    )
    expect(markdown).toContain('**Mode:** full · **Effort:** high')
    expect(markdown).toContain('- Security trigger: auth.ts.')
  })

  it('shows the summary, verdict, and the verified findings with their location', () => {
    expect(markdown).toContain('### What the pull request does\n\nIt adds a widget.')
    expect(markdown).toContain('### Verdict: Comment\n\nOne thing to fix.')
    expect(markdown).toContain('1. **[high]** Off by one (`a.ts:7-9`) (correctness)')
    expect(markdown).toContain('> Line one.\n> Line two.')
  })

  it('shows a finding prevention note under it, and nothing without one', () => {
    const data = buildReport(INPUT)
    const prevented = renderReport({
      ...data,
      findings: data.findings.map((finding) => ({
        ...finding,
        prevent: 'a test that loops the range',
      })),
    })
    expect(prevented).toContain('> Line two.\n\n**Prevent:** a test that loops the range')
    expect(markdown).not.toContain('Prevent')
  })

  it('shows a finding fix as a quoted section', () => {
    const data = buildReport(INPUT)
    const fixed = renderReport({
      ...data,
      findings: data.findings.map((finding) => ({ ...finding, fix: 'a\nb' })),
    })
    expect(fixed).toContain('> Line two.\n\n**For the fix:**\n\n> a\n> b')
  })

  it('shows questions, and still renders a report written before questions existed', () => {
    const data = buildReport(INPUT)
    const ask = { question: 'Is v1 gone?', askOf: 'product' as const, why: 'Rollout.' }
    expect(renderReport({ ...data, questions: [ask] })).toContain('- **Product:** Is v1 gone?')
    const old = JSON.parse(
      JSON.stringify({ ...data, questions: undefined, postWarnings: undefined }),
    ) as typeof data
    expect(renderReport(old)).not.toContain('### Questions')
    expect(renderReport(old)).not.toContain('### Posted text')
    expect(renderReport({ ...data, postWarnings: ['body too long'] })).toContain(
      '### Posted text\n\n- body too long',
    )
  })

  it('lists every raw finding per pillar, marking the dropped ones', () => {
    expect(markdown).toContain('#### correctness (sonnet)')
    expect(markdown).toContain('Skills loaded: skills:typescript-authoring')
    expect(markdown).toContain('Cost: $0.2500, 6 turns, plus 1 failed attempt(s)')
    expect(markdown).toContain('- **[high]** Off by one (`a.ts:7-9`) — kept')
    expect(markdown).toContain('- **[low]** Naming — dropped: Style only.')
    expect(markdown).toContain('- **[medium]** Layering (`b.ts`) — dropped\n')
    expect(markdown).toContain('Skills loaded: none')
    expect(markdown).toContain('Cost: no usage recorded')
    expect(markdown).toContain('No findings.')
    expect(markdown).toContain('Failed: Pillar run did not print JSON.')
  })

  it('lists skipped pillars and the total cost', () => {
    expect(markdown).toContain('- security: No security trigger paths changed.')
    expect(markdown).toContain(
      'Total: $1.9300 (skill selection $0.0100, pillars $0.4200, verifier $1.5000, opus)',
    )
  })

  it('renders placeholders for an empty review', () => {
    const empty = renderReport(
      buildReport({
        ...INPUT,
        pillars: [],
        skipped: [],
        reasons: [],
        verifier: undefined,
        skillSelection: { selected: [], available: 1, error: 'down', usage: null },
      }),
    )
    expect(empty).toContain('_The verifier returned no summary._')
    expect(empty).toContain('### Verified findings (0)\n\nNone.')
    expect(empty).toContain('### Skipped pillars\n\nNone.')
    expect(empty).toContain('Skills selected: none (selection error: down)')
    expect(empty).toContain(
      'Total: $0.0000 (skill selection $0.0000, pillars $0.0000, verifier $0.0000)',
    )
  })

  it('names no verdict when a full review has none', () => {
    expect(renderReport({ ...buildReport(INPUT), verdict: null })).toContain('### Verdict: none')
  })

  it('renders a skipped review with its reason', () => {
    const text = renderReport(
      buildReport({
        ...INPUT,
        mode: 'skip',
        skipReason: 'Lockfile only.',
        verdict: null,
        pillars: [],
        verifier: undefined,
        skillSelection: { selected: [], available: 0, usage: null },
      }),
    )
    expect(text).toContain('**Skipped:** Lockfile only.')
    expect(text).toContain('Total cost: $0.0000')
    expect(text).not.toContain('### Verdict')
  })

  it('shows n/a for a null cost and for a result without turns', () => {
    const base = buildReport(INPUT)
    const nulls = { ...base.pillars[0], usage: parseUsage({}) } as (typeof base.pillars)[number]
    const text = renderReport({ ...base, pillars: [nulls] })
    expect(text).toContain('Cost: n/a, n/a turns')
  })
})

describe('report files', () => {
  it('writes report.json and a report.md that `report` reproduces byte for byte', () => {
    const out = mkdtempSync(join(tmpdir(), 'report-'))
    dirs.push(out)
    const path = writeReportFiles(out, buildReport(INPUT))
    expect(path).toBe(join(out, 'report.md'))
    const written = readFileSync(path, 'utf8')
    writeFileSync(path, 'stale')
    expect(rerenderReport(out)).toBe(path)
    expect(readFileSync(path, 'utf8')).toBe(written)
    expect(JSON.parse(readFileSync(join(out, 'report.json'), 'utf8')).title).toBe('Add widget')
  })

  it('refuses a report.json of another version', () => {
    const out = mkdtempSync(join(tmpdir(), 'report-'))
    dirs.push(out)
    for (const text of ['{"version":2}', 'null']) {
      writeFileSync(join(out, 'report.json'), text)
      expect(() => rerenderReport(out)).toThrow('not a version 1 report')
    }
  })
})
