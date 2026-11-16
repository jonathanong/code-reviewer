import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { Exec } from '../benchmark/exec.mts'
import type { ReviewInput } from '../finding.mts'
import type { PostOutcome } from '../post.mts'
import type { PrepareSummary } from '../prepare.mts'
import type { PluginInfo } from '../plugins.mts'
import type { PillarResult } from './types.mts'

/** Everything `review` needs from outside: the label and GitHub steps, the plugins, and the model. */
export type ReviewSteps = {
  claim(): Promise<{ claimed: boolean }>
  prepare(): Promise<PrepareSummary>
  skip(reason: string): Promise<unknown>
  /** Drops the in-progress label without requeueing. */
  abort(): Promise<unknown>
  /** Renders what `post` would send for `input`, without posting. */
  preview(input: ReviewInput, headSha: string): Promise<PostOutcome>
  plugins(): Promise<PluginInfo>
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

export const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

export function titleOf(out: string): string {
  const { title } = JSON.parse(read(join(out, 'context.json'))) as { title?: unknown }
  return typeof title === 'string' ? title : '(untitled)'
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
