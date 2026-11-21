import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PluginInstall } from '../plugins.mts'
import type { Exec } from '../benchmark/exec.mts'
import type { PrepareSummary } from '../prepare.mts'
import type { ReviewOptions, ReviewSteps } from './review-support.mts'
import { buildContext, sectionsNamed } from '../context/build.mts'
import type { SplitSummary } from '../context/change-shape/split.mts'
import type { LinkedCommit } from '../context/types.mts'
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

/** Built for the verifier only: its structured result is kept and its text is not written to the file. */
const VERIFIER_SECTION = 'change-shape'
const CHANGE_SHAPE_TITLE = 'Change shape'

export type ReviewContextInput = {
  steps: Pick<ReviewSteps, 'exec' | 'rulePlugins'>
  options: Pick<ReviewOptions, 'repo' | 'pr' | 'tree' | 'out'>
  prepared: Pick<PrepareSummary, 'baseSha' | 'headSha'>
  installs: readonly PluginInstall[]
  skillChoice: Pick<SkillChoice, 'selected'>
}

/** The path of the written file, or the one line the report records for why there is none. */
export type ReviewContext = {
  file?: string
  note?: string
  linked?: LinkedCommit[]
  split?: SplitSummary
}

/** The structured results the verifier takes from the build, each only when there is one. */
export const verifierContextFields = (context: ReviewContext) => ({
  ...(context.linked === undefined ? {} : { regression: context.linked }),
  ...(context.split === undefined ? {} : { split: context.split }),
})

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
        sectionsNamed([...PILLAR_SECTIONS, VERIFIER_SECTION]),
      ),
      expired,
    ])
    const split = built.sections.find((section) => section.split !== undefined)?.split
    const forPillars = built.sections.filter((section) => section.title !== CHANGE_SHAPE_TITLE)
    const splitField = split === undefined ? {} : { split }
    if (forPillars.length === 0) {
      const note = `no section had anything to say${built.notes.map((n) => `; ${n}`).join('')}`
      return { note, ...splitField }
    }
    const file = join(options.out, CONTEXT_FILE)
    const notes = [...unreadable, ...built.notes]
    writeFileSync(file, renderContext({ sections: forPillars, notes }))
    const linked = built.sections.find((section) => section.linked !== undefined)?.linked
    return {
      file,
      ...(linked === undefined || linked.length === 0 ? {} : { linked }),
      ...splitField,
    }
  } catch (error) {
    return { note: (error as Error).message.split('\n')[0] as string }
  } finally {
    clearTimeout(timer)
  }
}
