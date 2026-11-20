import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { diffExcerpt, splitDiff } from '../diff-files.mts'
import { ReviewError, type ReviewInput, type Pillar } from '../finding.mts'
import { pluginSettings } from '../plugins.mts'
import { deriveVerdict } from '../render.mts'
import { buildReport, flattenFindings, costBreakdown, type ReportData } from './report.mts'
import { writeReportFiles } from './report-file.mts'
import { applyEvidence } from './evidence-step.mts'
import { renderPreview } from './preview.mts'
import { runPillars } from './pillars.mts'
import { webReferences } from './references-prompt.mts'
import { listRuleSkills, selectSkills } from './select-skills.mts'
import { runReviewVerifier } from './verify.mts'

import {
  countFindings,
  failedSkips,
  skipResult,
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
  if (mode === 'skip') {
    const skipReason = plan.skipReason as string
    await steps.skip(skipReason, headSha)
    closed.value = true
    const data = buildReport({
      ...base,
      mode,
      reasons: plan.reasons,
      skipReason,
      verdict: null,
      skipped: plan.skipped,
      skillSelection: { selected: [], available: 0, usage: null },
      pillars: [],
    })
    const report = writeReportFiles(out, data)
    return skipResult(mode, headSha, report)
  }
  const plugins = await steps.plugins()
  const settings = pluginSettings(plugins.enabled)
  const followUp = plan.sinceSha !== null
  const source = followUp ? 'since' : 'diff'
  const skillChoice = await selectSkills({
    title,
    index: read(join(out, source, 'INDEX.md')),
    excerpt: diffExcerpt(splitDiff(read(join(out, `${source}.patch`)))),
    skills: listRuleSkills(plugins.installs),
    settings,
    exec: steps.exec,
    cwd: tree,
  })
  writeJson(join(out, 'skills.json'), skillChoice)
  // A review without its rule skills looks like any other review, so it fails instead.
  if (skillChoice.error !== undefined) {
    throw new ReviewError(`Skill selection failed, so no review was run: ${skillChoice.error}`)
  }
  const run = runDir(out, plan.sinceSha)
  const web = webReferences(steps.references, steps.webReferences)
  const pillarsDir = join(steps.references, 'pillars')
  const results = await runPillars({
    pillars: plan.pillars,
    tree,
    run,
    mode,
    jobs: options.jobs,
    contract: read(join(pillarsDir, '_contract.md')),
    readPillar: (pillar: Pillar) => read(join(pillarsDir, `${pillar}.md`)),
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
  const skipped = [...plan.skipped, ...failedSkips(results)]
  const findings = flattenFindings(results)
  const output = await runReviewVerifier(
    {
      verifierPrompt: read(join(steps.references, 'verifier.md')),
      references: steps.references,
      run,
      findings,
      skipped,
      threads: threadIdsOf(out),
      ...(web === undefined ? {} : { web }),
    },
    { model: plan.verifierModel, mode, tree, settings, exec: steps.exec },
  )
  writeJson(join(out, 'verifier.json'), { ...output, dropped: [...output.dropped] })
  const { evidence, findings: verified } = await applyEvidence({
    setup: () => steps.evidence(),
    readPrompt: () => read(join(steps.references, 'evidence.md')),
    out,
    title,
    pullRequestSummary: output.pullRequestSummary,
    findings: output.findings,
    mode,
    tree,
    settings,
    exec: steps.exec,
  })
  const input: ReviewInput = {
    effort: plan.effort,
    summary: output.summary,
    skipped,
    findings: verified,
    questions: output.questions,
  }
  writeJson(join(out, 'review.json'), input)
  const outcome = await steps.preview(input, headSha)
  writeFileSync(join(out, 'preview.md'), renderPreview(outcome))
  const data: ReportData = buildReport({
    ...base,
    mode,
    reasons: plan.reasons,
    verdict: deriveVerdict(verified, output.questions),
    postWarnings: outcome.warnings,
    skipped,
    skillSelection: skillChoice,
    pillars: results,
    verifier: { model: plan.verifierModel, output: { ...output, findings: verified } },
    evidence,
    stack: run.stack,
    push: run.push,
  })
  const report = writeReportFiles(out, data)
  return {
    ok: true,
    summary: {
      claimed: true,
      mode,
      verdict: data.verdict,
      findings: countFindings(verified),
      questions: output.questions.length,
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
