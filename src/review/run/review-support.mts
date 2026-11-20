import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Exec } from '../benchmark/exec.mts'
import type { Finding, ReviewInput } from '../finding.mts'
import type { Mode } from '../mode.mts'
import type { PostOutcome } from '../post.mts'
import type { PrepareSummary } from '../prepare.mts'
import { carriedNotes } from '../carried-note.mts'
import { readCarriedFile } from '../carried-file.mts'
import { readPushFile } from '../push-file.mts'
import { readStackFile } from '../stack-file.mts'
import type { PluginInfo } from '../plugins.mts'
import type { ReferenceSource } from '../rules/references-parse.mts'
import type { EvidenceSetup } from './evidence-types.mts'
import type { RunDir } from './pillar-prompt.mts'
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
  /** The machine-configured evidence sources for the repository and the reader for their guides. */
  evidence(): Promise<EvidenceSetup>
  /** The machine-configured web references for the repository; none when absent. */
  webReferences?: readonly ReferenceSource[]
  /** False when the settings switch off the second check on an approval. */
  approvalCheck: boolean
  exec: Exec
  /** Directory holding `verifier.md` and `pillars/`. */
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
}

export type ReviewResult = { ok: boolean; summary: Record<string, unknown> }

export function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

export function read(path: string): string {
  return readFileSync(path, 'utf8')
}

/** The run directory as the pillars and the verifier see it: what `prepare` wrote there. */
export function runDir(out: string, sinceSha: string | null): RunDir {
  return {
    out,
    sinceSha,
    hasRules: existsSync(join(out, 'rules', 'INDEX.md')),
    stack: readStackFile(out),
    push: readPushFile(out),
    carried: readCarriedFile(out),
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
  for (const finding of findings) counts[finding.severity] += 1
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

/** The notes `review.json` carries: what `prepare` found that is true of the pull request itself. */
export function contextNotes(run: RunDir): string[] {
  return run.carried === undefined ? [] : carriedNotes(run.carried)
}
