import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Exec } from '../benchmark/exec.mts'
import { ReviewError, type Finding, type ReviewInput } from '../finding.mts'
import { actionable } from '../render.mts'
import type { Pillar } from '../pillar-name.mts'
import type { PillarSettings } from '../pillars-settings.mts'
import type { TargetSettings } from '../targets-settings.mts'
import type { Mode } from '../mode.mts'
import type { PostOutcome } from '../post.mts'
import type { PrepareSummary } from '../prepare.mts'
import { carriedNotes } from '../carried-note.mts'
import { readCarriedFile } from '../carried-file.mts'
import { mergeDependencies, readDependencies, type Dependency } from '../dependency.mts'
import { readIssues } from '../issues.mts'
import { readDocs } from '../related-docs-file.mts'
import { readPushFile } from '../push-file.mts'
import { readStackFile } from '../stack-file.mts'
import {
  pluginSettings,
  unloadableMessage,
  unloadableRulePlugins,
  type PluginInfo,
  type PluginInstall,
} from '../plugins.mts'
import type { StepModels } from '../models.mts'
import type { ReferenceSource } from '../rules/references-parse.mts'
import type { AnalysisSetup } from './analysis-prompt.mts'
import type { EvidenceSetup } from './evidence-types.mts'
import type { RunDir } from './pillar-prompt.mts'
import { renderRulePlugins } from './rule-plugins-prompt.mts'
import { listRuleSkills, type RuleSkill } from './select-skills.mts'
import type { PillarResult } from './types.mts'

/** Everything `review` needs from outside: the label and GitHub steps, the plugins, and the model. */
export type ReviewSteps = {
  claim(): Promise<{ claimed: boolean }>
  prepare(): Promise<PrepareSummary>
  /** Posts the skip review on `headSha`, the head `prepare` saw, and closes the labels. */
  skip(reason: string, headSha: string): Promise<unknown>
  /** Drops the in-progress label without requeueing. */
  abort(): Promise<unknown>
  /** Renders what `post` would send for `input`, without posting. */
  preview(input: ReviewInput, headSha: string): Promise<PostOutcome>
  plugins(): Promise<PluginInfo>
  /** The plugins whose skills hold the shared rules; empty means repository rules only. */
  rulePlugins: readonly string[]
  /** The machine-configured evidence sources for the repository and the reader for their guides. */
  evidence(): Promise<EvidenceSetup>
  /** The machine-configured analysis tools and the reader for their guides; none when absent. */
  analysis?(): Promise<AnalysisSetup>
  /** The machine-configured web references for the repository; none when absent. */
  webReferences?: readonly ReferenceSource[]
  /** False when the settings switch off the second check on an approval. */
  approvalCheck: boolean
  /** True when the settings let the verifier answer other reviewers' threads; off when absent. */
  answers?: boolean
  pillars?: PillarSettings
  /** Built-in targeted checks to skip; all enabled when absent. */
  targets?: TargetSettings
  models?: StepModels
  stateDir?: string
  exec: Exec
  /** Directory holding `verifier.md`, `pillars/`, and `targets/`. */
  references: string
}

export type ReviewOptions = {
  repo: string
  pr: number
  /** Absolute run directory. */
  out: string
  /** Absolute checkout of the pull request head. */
  tree: string
  jobs: number
  /** The requester's points to check beside the pillars; absent when none were given. */
  focus?: readonly string[] | undefined
}

export type ReviewResult = { ok: boolean; summary: Record<string, unknown> }

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function read(path: string): string {
  return readFileSync(path, 'utf8')
}

/** The run directory as the pillars and the verifier see it: what `prepare` wrote there. */
export function runDir(
  out: string,
  sinceSha: string | null,
  rulePlugins?: readonly string[],
): RunDir {
  return {
    rulePlugins,
    out,
    sinceSha,
    hasRules: existsSync(join(out, 'rules', 'INDEX.md')),
    stack: readStackFile(out),
    push: readPushFile(out),
    carried: readCarriedFile(out),
    dependencies: readDependencies(out),
    issues: readIssues(out),
    docs: readDocs(out),
  }
}

/** The `--settings` and skills offered for selection; a rule plugin that is not loadable or holds none fails the review. */
export async function loadRulePlugins(
  steps: ReviewSteps,
): Promise<{ settings: object; skills: RuleSkill[]; installs: PluginInstall[] }> {
  const plugins = await steps.plugins()
  const missing = unloadableRulePlugins(plugins.installs, steps.rulePlugins)
  if (missing.length > 0) throw new ReviewError(unloadableMessage(missing))
  const skills = listRuleSkills(plugins.installs, steps.rulePlugins)
  const empty = steps.rulePlugins.filter(
    (name) => !skills.some((skill) => skill.name.startsWith(`${name}:`)),
  )
  if (empty.length > 0) throw new ReviewError(`rule plugins with no skills: ${empty.join(', ')}`)
  return {
    settings: pluginSettings(plugins.enabled, steps.rulePlugins),
    skills,
    installs: plugins.installs,
  }
}

/** The pillar contract and pillar files as the headless runs read them, for the configured rule plugins. */
export function pillarTexts(steps: ReviewSteps): {
  contract: string
  readPillar: (pillar: Pillar) => string
} {
  const dir = join(steps.references, 'pillars')
  return {
    contract: renderRulePlugins(read(join(dir, '_contract.md')), steps.rulePlugins, true),
    readPillar: (pillar) => renderRulePlugins(read(join(dir, `${pillar}.md`)), steps.rulePlugins),
  }
}

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function titleOf(out: string): string {
  const { title } = JSON.parse(read(join(out, 'context.json'))) as { title?: unknown }
  return typeof title === 'string' ? title : '(untitled)'
}

/** Thread ids of the unresolved earlier findings that `prepare` recorded. */
export function threadIdsOf(out: string): string[] {
  const { unresolved } = JSON.parse(read(join(out, 'context.json'))) as { unresolved?: unknown }
  const entries = Array.isArray(unresolved) ? (unresolved as Array<{ threadId?: unknown }>) : []
  return entries.flatMap((entry) => (typeof entry?.threadId === 'string' ? [entry.threadId] : []))
}

/** The pillars that never answered, as `skipped` entries that are safe to post. */
export function failedSkips(results: readonly PillarResult[]) {
  return results
    .filter((result) => result.error !== undefined)
    .map((result) => ({
      pillar: result.pillar,
      reason: `The run failed twice: ${(result.error as string).split('\n')[0]?.slice(0, 160)}`,
    }))
}

export const ZERO_FINDINGS = { blocking: 0, high: 0, medium: 0, low: 0 }

export function countFindings(findings: readonly Finding[]) {
  const counts = { ...ZERO_FINDINGS }
  for (const finding of actionable(findings)) counts[finding.severity] += 1
  return counts
}

/** The result of a review that posted a skip and ran no model. */
export function skipResult(mode: Mode, headSha: string, report: string): ReviewResult {
  return {
    ok: true,
    summary: {
      claimed: true,
      mode,
      verdict: null,
      findings: ZERO_FINDINGS,
      costUsd: 0,
      report,
      review: null,
      headSha,
    },
  }
}

/** What the pull request depends on: what `prepare` found, then what the verifier added. */
export function reviewDependencies(run: RunDir, implied: readonly Dependency[]): Dependency[] {
  return mergeDependencies(run.dependencies ?? [], implied)
}

/** The `notes` field of `review.json`, absent when `prepare` found nothing true of the pull request itself. */
export function noteFields(run: RunDir): { notes?: string[] } {
  const notes = run.carried === undefined ? [] : carriedNotes(run.carried)
  return notes.length === 0 ? {} : { notes }
}
