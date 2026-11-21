import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PluginInstall } from '../plugins.mts'
import type { Exec } from '../benchmark/exec.mts'
import type { PrepareSummary } from '../prepare.mts'
import type { ReviewOptions, ReviewSteps } from './review-support.mts'
import { buildContext, sectionsNamed } from '../context/build.mts'
import { renderContext } from '../context/render.mts'
import type { SkillChoice } from './types.mts'
import { listRuleSkillFiles } from './select-skills.mts'

/** The file in the run directory. `context.md` is taken: `prepare` writes the description there. */
export const CONTEXT_FILE = 'review-context.md'

/** The whole build, git calls and file reads included, gets this long. */
export const CONTEXT_DEADLINE_MS = 60_000

/**
 * The sections pillars read. Not `change-shape`, and nothing about other reviewers or past
 * reviews: pillars are independent finders and must not be anchored by other reviewers' text.
 */
export const PILLAR_SECTIONS = ['rule-excerpts', 'changed-line-history', 'linked-regressions']

export type ReviewContextInput = {
  steps: Pick<ReviewSteps, 'exec' | 'rulePlugins'>
  options: Pick<ReviewOptions, 'repo' | 'pr' | 'tree' | 'out'>
  prepared: Pick<PrepareSummary, 'baseSha' | 'headSha'>
  installs: readonly PluginInstall[]
  skillChoice: Pick<SkillChoice, 'selected'>
}

/** The path of the written file, or the one line the report records for why there is none. */
export type ReviewContext = { file?: string; note?: string }

/**
 * Builds the context the pillars read and writes it to `out/review-context.md`. Never throws: a
 * failed, timed out or empty build gives a note and no file, and the review goes on without it.
 */
export async function buildReviewContext(
  { steps, options, prepared, installs, skillChoice }: ReviewContextInput,
  deadlineMs = CONTEXT_DEADLINE_MS,
): Promise<ReviewContext> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deadlineMs)
  const expired = new Promise<never>((_, fail) =>
    controller.signal.addEventListener(
      'abort',
      () => fail(new Error(`timed out after ${deadlineMs / 1000}s`)),
      { once: true },
    ),
  )
  const exec: Exec = (command, args, opts) =>
    steps.exec(command, args, { ...opts, signal: controller.signal })
  try {
    const unreadable: string[] = []
    const skills = listRuleSkillFiles(installs, steps.rulePlugins, unreadable).filter((skill) =>
      skillChoice.selected.includes(skill.name),
    )
    const built = await Promise.race([
      buildContext(
        { ...options, baseSha: prepared.baseSha, headSha: prepared.headSha, skills },
        { exec, readFile: async (path) => readFileSync(path, 'utf8') },
        sectionsNamed(PILLAR_SECTIONS),
      ),
      expired,
    ])
    if (built.sections.length === 0) {
      return { note: `no section had anything to say${built.notes.map((n) => `; ${n}`).join('')}` }
    }
    const file = join(options.out, CONTEXT_FILE)
    writeFileSync(file, renderContext({ ...built, notes: [...unreadable, ...built.notes] }))
    return { file }
  } catch (error) {
    return { note: (error as Error).message.split('\n')[0] as string }
  } finally {
    clearTimeout(timer)
  }
}
