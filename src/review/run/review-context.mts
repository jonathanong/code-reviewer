import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { PluginInstall } from '../plugins.mts'
import type { Exec } from '../benchmark/exec.mts'
import type { PrepareSummary } from '../prepare.mts'
import type { ReviewOptions, ReviewSteps } from './review-support.mts'
import { buildContext, sectionsNamed } from '../context/build.mts'
import type { SplitSummary } from '../context/change-shape/split.mts'
import type { LinkedCommit, PreviousReview } from '../context/types.mts'
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
const FOLLOW_UP_SECTION = 'past-reviews'
/** Sections built for the verifier only; the pillars read none of their text. */
const VERIFIER_TITLES = ['Change shape', 'Past reviews']

export type ReviewContextInput = {
  steps: Pick<ReviewSteps, 'exec' | 'rulePlugins' | 'stateDir'>
  options: Pick<ReviewOptions, 'repo' | 'pr' | 'tree' | 'out'>
  /** A plan with a `sinceSha` makes this a follow-up, which also reads the earlier review. */
  prepared: Pick<PrepareSummary, 'baseSha' | 'headSha'> & { plan?: { sinceSha: string | null } }
  installs: readonly PluginInstall[]
  skillChoice: Pick<SkillChoice, 'selected'>
}

/** The path of the written file, or the one line the report records for why there is none. */
export type ReviewContext = {
  file?: string
  note?: string
  linked?: LinkedCommit[]
  split?: SplitSummary
  previous?: PreviousReview
  /** Why a follow-up got no earlier review, for the report. */
  previousNote?: string
}

/** The structured results the verifier takes from the build, each only when there is one. */
export const verifierContextFields = (context: ReviewContext) => ({
  ...(context.linked === undefined ? {} : { regression: context.linked }),
  ...(context.split === undefined ? {} : { split: context.split }),
  ...(context.previous === undefined ? {} : { previous: context.previous }),
})

/** What the report records of the build: why there is no context file, the linked commits, the earlier-review note. */
export const reportFields = (context: ReviewContext) => ({
  contextNote: context.note,
  regression: context.linked,
  earlierReviewNote: context.previousNote,
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
    // Only a follow-up reads this machine's earlier review, and only when the state directory is known.
    const followUp = typeof prepared.plan?.sinceSha === 'string' && steps.stateDir !== undefined
    const built = await Promise.race([
      buildContext(
        { ...options, baseSha: prepared.baseSha, headSha: prepared.headSha, skills },
        {
          exec,
          readFile: async (path) => readFileSync(path, 'utf8'),
          ...(steps.stateDir === undefined ? {} : { stateDir: steps.stateDir }),
        },
        sectionsNamed([
          ...PILLAR_SECTIONS,
          VERIFIER_SECTION,
          ...(followUp ? [FOLLOW_UP_SECTION] : []),
        ]),
      ),
      expired,
    ])
    const split = built.sections.find((section) => section.split !== undefined)?.split
    const forPillars = built.sections.filter((section) => !VERIFIER_TITLES.includes(section.title))
    const splitField = split === undefined ? {} : { split }
    const earlier = built.sections.find((section) => section.title === 'Past reviews')
    const failed = built.notes.find((note) => note.startsWith(`${FOLLOW_UP_SECTION} failed`))
    const previousNote = earlier?.previousNote ?? failed
    const previousFields = {
      ...(earlier?.previous === undefined ? {} : { previous: earlier.previous }),
      ...(previousNote === undefined ? {} : { previousNote }),
    }
    const kept = built.notes.filter((note) => note !== failed)
    if (forPillars.length === 0) {
      const note = `no section had anything to say${kept.map((n) => `; ${n}`).join('')}`
      return { note, ...splitField, ...previousFields }
    }
    const file = join(options.out, CONTEXT_FILE)
    writeFileSync(file, renderContext({ sections: forPillars, notes: [...unreadable, ...kept] }))
    const linked = built.sections.find((section) => section.linked !== undefined)?.linked
    return {
      file,
      ...(linked === undefined || linked.length === 0 ? {} : { linked }),
      ...splitField,
      ...previousFields,
    }
  } catch (error) {
    return { note: (error as Error).message.split('\n')[0] as string }
  } finally {
    clearTimeout(timer)
  }
}
