import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { diffExcerpt, splitDiff } from '../diff-files.mts'
import { ReviewError, type ReviewInput } from '../finding.mts'
import { deriveVerdict } from '../render.mts'
import { buildReport, flattenFindings, costBreakdown, type ReportData } from './report.mts'
import { writeReportFiles } from './report-file.mts'
import { applyApprovalCheck } from './approval-check.mts'
import { approvalCheckInput } from './approval-check-prompt.mts'
import { skipReview } from './review-skip.mts'
import { applyEvidence } from './evidence-step.mts'
import { renderPreview } from './preview.mts'
import { runPillars } from './pillars.mts'
import { webReferences } from './references-prompt.mts'
import { selectSkills } from './select-skills.mts'
import { runReviewVerifier } from './verify.mts'

import {
  loadRulePlugins,
  noteFields,
  pillarTexts,
  reviewDependencies,
  countFindings,
  failedSkips,
  message,
  read,
  runDir,
  threadIdsOf,
  titleOf,
  writeJson,
  type ReviewOptions,
  type ReviewResult,
  type ReviewSteps,
} from './review-support.mts'

export type { ReviewOptions, ReviewResult, ReviewSteps }

async function review(
  steps: ReviewSteps,
  options: ReviewOptions,
  closed: { value: boolean },
): Promise<ReviewResult> {
  const { out, tree } = options
  const prepared = await steps.prepare()
  const { plan, headSha } = prepared
  const title = titleOf(out)
  const base = { repo: options.repo, pr: options.pr, title, headSha, effort: plan.effort }
  const mode = plan.mode
  if (mode === 'skip') return skipReview(steps, plan, { ...base, mode }, out, closed)
  const { settings, skills } = await loadRulePlugins(steps)
  const followUp = plan.sinceSha !== null
  const source = followUp ? 'since' : 'diff'
  const skillChoice = await selectSkills({
    title,
    index: read(join(out, source, 'INDEX.md')),
    excerpt: diffExcerpt(splitDiff(read(join(out, `${source}.patch`)))),
    skills,
    rulePlugins: steps.rulePlugins,
    settings,
    exec: steps.exec,
    cwd: tree,
  })
  writeJson(join(out, 'skills.json'), skillChoice)
  // A review without its rule skills looks like any other review, so it fails instead.
  if (skillChoice.error !== undefined) {
    throw new ReviewError(`Skill selection failed, so no review was run: ${skillChoice.error}`)
  }
  const run = runDir(out, plan.sinceSha, steps.rulePlugins)
  const web = webReferences(steps.references, steps.webReferences)
  const prompts = pillarTexts(steps)
  const results = await runPillars({
    pillars: plan.pillars,
    tree,
    run,
    mode,
    jobs: options.jobs,
    ...prompts,
    skills: skillChoice.selected,
    settings,
    ...(web === undefined ? {} : { web }),
    exec: steps.exec,
  })
  // A review with no pillar answer would approve unchecked code, so it fails instead.
  if (results.every((result) => result.error !== undefined)) {
    throw new ReviewError(
      `Every pillar failed: ${results.map((result) => `${result.pillar} (${(result.error as string).split('\n')[0]})`).join('; ')}`,
    )
  }
  const pillarSkips = [...plan.skipped, ...failedSkips(results)]
  const findings = flattenFindings(results)
  const output = await runReviewVerifier(
    {
      verifierPrompt: read(join(steps.references, 'verifier.md')),
      references: steps.references,
      run,
      findings,
      skipped: pillarSkips,
      threads: threadIdsOf(out),
      ...(web === undefined ? {} : { web }),
    },
    { model: plan.verifierModel, mode, tree, settings, exec: steps.exec },
  )
  writeJson(join(out, 'verifier.json'), { ...output, dropped: [...output.dropped] })
  const second = await applyApprovalCheck({
    enabled: steps.approvalCheck,
    mode,
    model: plan.verifierModel,
    tree,
    settings,
    exec: steps.exec,
    input: approvalCheckInput(steps.references, run, output, results, findings, pillarSkips),
  })
  const { skipped, questions } = second
  const { evidence, findings: verified } = await applyEvidence({
    setup: () => steps.evidence(),
    readPrompt: () => read(join(steps.references, 'evidence.md')),
    out,
    title,
    pullRequestSummary: output.pullRequestSummary,
    findings: second.findings,
    mode,
    tree,
    settings,
    exec: steps.exec,
  })
  const dependencies = reviewDependencies(run, output.dependencies)
  const input: ReviewInput = {
    effort: plan.effort,
    summary: output.summary,
    skipped,
    findings: verified,
    questions,
    ...noteFields(run),
    ...(dependencies.length === 0 ? {} : { dependencies }),
  }
  writeJson(join(out, 'review.json'), input)
  const outcome = await steps.preview(input, headSha)
  writeFileSync(join(out, 'preview.md'), renderPreview(outcome))
  const data: ReportData = buildReport({
    ...base,
    mode,
    reasons: plan.reasons,
    verdict: deriveVerdict(verified, questions, skipped),
    postWarnings: outcome.warnings,
    skipped,
    skillSelection: skillChoice,
    pillars: results,
    verifier: { model: plan.verifierModel, output: { ...output, findings: verified, questions } },
    evidence,
    approvalCheck: second.check,
    stack: run.stack,
    push: run.push,
    carried: run.carried,
    dependencies,
  })
  const report = writeReportFiles(out, data)
  return {
    ok: true,
    summary: {
      claimed: true,
      mode,
      verdict: data.verdict,
      findings: countFindings(verified),
      questions: questions.length,
      ...(second.check === undefined ? {} : { approvalCheck: second.check.outcome }),
      costUsd: costBreakdown(data).total,
      report,
      review: join(out, 'review.json'),
      headSha,
      fixedThreadIds: output.fixedThreadIds,
    },
  }
}

/**
 * Runs a whole review headlessly and stops before posting: claim, prepare, select skills, run the
 * pillars, verify, and write the review, its preview, and the report. Labels stay at processing.
 * After a failure the claim is dropped without a requeue, unless `skip` already closed it.
 */
export async function runReview(steps: ReviewSteps, options: ReviewOptions): Promise<ReviewResult> {
  const claim = await steps.claim()
  if (!claim.claimed) return { ok: true, summary: { ...claim } }
  const closed = { value: false }
  try {
    // Inside the guard: a claim must be dropped when the output directory cannot be made.
    mkdirSync(options.out, { recursive: true })
    return await review(steps, options, closed)
  } catch (error) {
    const summary: Record<string, unknown> = { claimed: true, error: message(error) }
    if (!closed.value) {
      try {
        await steps.abort()
      } catch (abortError) {
        summary.abortError = message(abortError)
      }
    }
    return { ok: false, summary }
  }
}
