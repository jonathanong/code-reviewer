import { runFixedModel } from '../../harness/runner.mts'
import { READ_ONLY, type HarnessRun } from '../../harness/types.mts'
import { ReviewError, SEVERITIES, parseReviewInput, type Finding } from '../finding.mts'
import { PILLARS } from '../pillar-name.mts'
import { FLAGS_SCHEMA, type Flag } from '../flag.mts'
import { QUESTIONS_SCHEMA, type Question } from '../question.mts'
import type { EvalCase } from './cases.mts'
import type { Usage } from './usage.mts'
import { SKILL_READER } from '../run/pillar-capabilities.mts'
import { hasRulesIndex, relatedDocs, type Exec } from './snapshot.mts'
import { buildVerifierPrompt } from './verifier-prompt.mts'
import type { VerifierRun } from './verifier-input.mts'
import { withAnswers, type AnswerRules } from '../run/answers-prompt.mts'
import type { Answerable } from '../context/answerable.mts'
import { gradeAnswers, notesOf, type AnswerGrade } from './verifier-answers.mts'
import { gradeFollowUp, type FollowUpGrade } from './followup-grade.mts'
import { droppedReasons } from '../run/verify-dropped.mts'
import { withFixedThreads, type FollowUpCase } from './followup-case.mts'
import { followUpBodyInputs } from './followup-prompt.mts'

export const VERIFIER_OUTPUT_SCHEMA = {
  type: 'object',
  required: ['summary', 'findings'],
  additionalProperties: false,
  properties: {
    summary: { type: 'string' },
    questions: QUESTIONS_SCHEMA,
    flags: FLAGS_SCHEMA,
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['pillar', 'severity', 'title', 'body', 'sources'],
        additionalProperties: false,
        properties: {
          pillar: { type: 'string', enum: [...PILLARS] },
          severity: { type: 'string', enum: [...SEVERITIES] },
          title: { type: 'string' },
          body: { type: 'string' },
          path: { type: 'string' },
          line: { type: 'integer', minimum: 1 },
          side: { type: 'string', enum: ['LEFT', 'RIGHT'] },
          startLine: { type: 'integer', minimum: 1 },
          fix: { type: 'string' },
          suggestion: { type: 'string' },
          prevent: { type: 'string' },
          preExisting: { type: 'boolean' },
          sources: { type: 'array', items: { type: 'integer', minimum: 0 } },
        },
      },
    },
  },
} as const

export type VerifierOutput = {
  summary: string
  findings: Finding[]
  questions: Question[]
  /** Concerns only a person can settle; absent when there are none. */
  flags?: Flag[]
  sources: number[][]
}

/** `skills` adds the Skill tool, so cited rule skills can be loaded; off for control runs. */
export function verifierRequest(
  prompt: string,
  model: string,
  maxTurns: number,
  skills = false,
  settings?: object,
  answerable?: readonly Answerable[],
  followUp?: FollowUpCase,
): HarnessRun {
  return {
    prompt,
    label: 'Verifier run',
    model,
    maxTurns,
    schema: withFixedThreads(withAnswers(VERIFIER_OUTPUT_SCHEMA, answerable), followUp),
    can: skills ? SKILL_READER : READ_ONLY,
    ...(answerable === undefined ? {} : { transcript: true }),
    ...(settings === undefined ? {} : { settings }),
  }
}

/** Validates a verifier's structured output object; shared by the benchmark and `review`. */
export function validateVerifierOutput(value: unknown, inputCount: number): VerifierOutput {
  const structured = value as
    | { summary?: unknown; findings?: unknown; questions?: unknown; flags?: unknown }
    | undefined
    | null
  if (structured === undefined || structured === null || !Array.isArray(structured.findings)) {
    throw new ReviewError('Verifier run returned no structured findings.')
  }
  const raw = structured.findings as Array<{ sources?: unknown } | null>
  const sources = raw.map((entry, index) => {
    const list = entry?.sources
    const valid =
      Array.isArray(list) &&
      list.every((value) => Number.isInteger(value) && value >= 0 && value < inputCount)
    if (!valid) throw new ReviewError(`findings[${index}].sources must list input indexes.`)
    return list as number[]
  })
  const review = parseReviewInput({
    summary: structured.summary,
    findings: raw,
    questions: structured.questions,
    flags: structured.flags,
  })
  return {
    summary: review.summary,
    findings: review.findings,
    questions: review.questions,
    ...(review.flags === undefined ? {} : { flags: review.flags }),
    sources,
  }
}

/** Runs the verifier once in the snapshot directory with read-only tools. */
export async function runVerifier(
  item: EvalCase,
  dir: string,
  findings: readonly Finding[],
  run: VerifierRun,
  exec: Exec,
  /** The installed rule skills an answer may cite; read only for a case that lists notes. */
  answerRules?: AnswerRules,
): Promise<{
  output: VerifierOutput
  usage: Usage
  answers?: AnswerGrade
  followUp?: FollowUpGrade
}> {
  const rules = hasRulesIndex(dir)
  const notes = notesOf(item)
  const docs = relatedDocs(dir)
  const prompt = buildVerifierPrompt(
    run.verifierPrompt,
    item,
    findings,
    rules,
    docs,
    notes,
    item.followUp,
  )
  const { structured, usage, skills } = await runFixedModel(
    {
      ...verifierRequest(
        prompt,
        run.model,
        run.maxTurns,
        rules,
        run.settings,
        notes,
        item.followUp,
      ),
      cwd: dir,
    },
    exec,
  )
  const input = [...findings, ...followUpBodyInputs(item.followUp)]
  const output = validateVerifierOutput(structured, input.length)
  const followed =
    item.followUp === undefined
      ? {}
      : {
          followUp: gradeFollowUp(
            item.followUp,
            (structured as { fixedThreadIds?: unknown }).fixedThreadIds,
            {
              first: findings.length,
              sources: output.sources,
              dropped: droppedReasons((structured as { dropped?: unknown }).dropped, input.length),
            },
          ),
        }
  if (item.answerable === undefined) return { output, usage, ...followed }
  const none = { texts: new Map<string, string>(), selected: [] }
  const raw = (structured as { answers?: unknown }).answers
  const graded = gradeAnswers(item.answerable, raw, answerRules ?? none, skills)
  return { output, usage, answers: graded, ...followed }
}
