import { join } from 'node:path'
import { parseArgs } from 'node:util'

import { resolveModelPlan, type StepModels } from '../models.mts'
import { breakingChangeRule, judgeReplies, type Judgment } from '../replies/judge.mts'
import type { ReplyState } from '../replies/marker.mts'
import { REPLY_STATES } from '../replies/marker.mts'
import type { ReplyCandidate } from '../replies/select.mts'
import { defaultReferencesDir } from '../targets.mts'
import { SEVERITIES, type Severity } from '../finding.mts'
import { defaultBenchDeps, type BenchDeps } from './cli.mts'

/** One earlier finding with the author's replies, and what a correct judgment of it is. */
export type RepliesCase = {
  id: string
  candidate: ReplyCandidate
  expected: ReplyState
  /** For `downgraded`: the severity the finding must be lowered to. */
  expectedSeverity?: Severity
}

export type RepliesScore = {
  id: string
  expected: ReplyState
  got: ReplyState | 'error'
  severity: Severity | null
  pass: boolean
  costUsd: number | null
  why: string
}

export function parseRepliesCases(raw: unknown): RepliesCase[] {
  if (!Array.isArray(raw) || raw.length === 0)
    throw new Error('bench-replies: cases must be a list.')
  const ids = new Set<string>()
  return raw.map((entry: Record<string, unknown>) => {
    const { id, candidate, expected, expectedSeverity } = entry
    if (typeof id !== 'string' || id === '' || ids.has(id)) {
      throw new Error('bench-replies: every case needs a unique id.')
    }
    ids.add(id)
    if (typeof candidate !== 'object' || candidate === null) {
      throw new Error(`bench-replies ${id}: candidate is required.`)
    }
    if (!REPLY_STATES.some((state) => state === expected)) {
      throw new Error(`bench-replies ${id}: expected must be one of ${REPLY_STATES.join(', ')}.`)
    }
    if (expected === 'downgraded' && !SEVERITIES.some((level) => level === expectedSeverity)) {
      throw new Error(`bench-replies ${id}: a downgraded case needs expectedSeverity.`)
    }
    return {
      id,
      candidate: { ...(candidate as ReplyCandidate), thread: id },
      expected: expected as ReplyState,
      ...(typeof expectedSeverity === 'string'
        ? { expectedSeverity: expectedSeverity as Severity }
        : {}),
    }
  })
}

/** Deterministic grade: the outcome must match, and a lowered finding must land on the expected severity. */
export function scoreReplies(
  item: RepliesCase,
  judgment: Judgment | undefined,
  costUsd: number | null,
): RepliesScore {
  if (judgment === undefined) {
    return {
      id: item.id,
      expected: item.expected,
      got: 'error',
      severity: null,
      pass: false,
      costUsd,
      why: '',
    }
  }
  const severityOk = item.expected !== 'downgraded' || judgment.severity === item.expectedSeverity
  return {
    id: item.id,
    expected: item.expected,
    got: judgment.outcome,
    severity: judgment.severity,
    pass: judgment.outcome === item.expected && severityOk,
    costUsd,
    why: judgment.why,
  }
}

export function renderReplies(scores: readonly RepliesScore[]): string {
  const rows = scores.map(
    (score) =>
      `| ${score.id} | ${score.expected} | ${score.got}${score.severity === null ? '' : ` (${score.severity})`} | ${score.pass ? 'pass' : 'FAIL'} | ${score.costUsd === null ? 'n/a' : `$${score.costUsd.toFixed(4)}`} |`,
  )
  const passed = scores.filter((score) => score.pass).length
  return [
    `Passed ${passed} of ${scores.length}.`,
    '',
    '| Case | Expected | Got | Result | Cost |',
    '| --- | --- | --- | --- | --- |',
    ...rows,
  ].join('\n')
}

const positive = (value: string, name: string): number => {
  const count = Number(value)
  if (!Number.isInteger(count) || count < 1)
    throw new Error(`--${name} must be a positive integer.`)
  return count
}

/**
 * `code-reviewer bench-replies`: runs the real `replies` step on each case's finding and replies
 * (each case alone, no checkout, no tools) and grades the outcome against the expected one.
 */
export async function runRepliesBenchCli(
  args: string[],
  deps: BenchDeps = defaultBenchDeps,
): Promise<number> {
  const { values } = parseArgs({
    args,
    strict: true,
    options: {
      cases: { type: 'string' },
      out: { type: 'string' },
      case: { type: 'string', multiple: true },
      prompts: { type: 'string' },
      model: { type: 'string' },
      attempts: { type: 'string' },
    },
  })
  if (values.cases === undefined || values.out === undefined) {
    throw new Error('bench-replies needs --cases and --out.')
  }
  const ids = new Set(values.case ?? [])
  const cases = parseRepliesCases(JSON.parse(deps.readFile(values.cases)) as unknown).filter(
    (item) => ids.size === 0 || ids.has(item.id),
  )
  if (cases.length === 0) throw new Error('bench-replies found no cases.')
  const attempts = positive(values.attempts ?? '1', 'attempts')
  const rule = breakingChangeRule(values.prompts ?? defaultReferencesDir())
  if (rule === undefined) throw new Error('bench-replies: verifier.md has no breaking-change rule.')
  const models: StepModels | undefined =
    values.model === undefined
      ? undefined
      : {
          plan: resolveModelPlan(undefined, {
            replies: [{ harness: 'claude', model: values.model }],
          }),
        }
  const scores: RepliesScore[] = []
  for (const item of cases) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      deps.log(`replies ${item.id} ${attempt}/${attempts}`)
      const result = await judgeReplies([item.candidate], rule, {
        models,
        exec: deps.exec,
        cwd: process.cwd(),
      })
      const score = scoreReplies(
        item,
        result.error === undefined ? result.judgments[0] : undefined,
        result.usage?.costUsd ?? null,
      )
      scores.push({ ...score, id: attempts === 1 ? item.id : `${item.id}#${attempt}` })
    }
  }
  const summaryPath = join(values.out, 'summary.md')
  deps.writeFile(join(values.out, 'summary.json'), `${JSON.stringify({ scores }, null, 2)}\n`)
  deps.writeFile(summaryPath, `${renderReplies(scores)}\n`)
  const passed = scores.filter((score) => score.pass).length
  const cost = scores.reduce((sum, score) => sum + (score.costUsd ?? 0), 0)
  process.stdout.write(
    `${JSON.stringify({ summary: summaryPath, attempts: scores.length, passed, costUsd: cost })}\n`,
  )
  return 0
}
