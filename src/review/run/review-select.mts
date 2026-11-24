import { join } from 'node:path'

import { diffExcerpt, splitDiff } from '../diff-files.mts'
import { ReviewError } from '../finding.mts'
import type { ReviewPlan } from '../plan.mts'
import { saveFailedSteps } from './failed-steps.mts'
import { enabledReviewTargets } from './review-focus.mts'
import { read, writeJson, type ReviewSteps } from './review-support.mts'
import { selectSkills, type RuleSkill } from './select-skills.mts'
import type { SkillChoice } from './types.mts'

/**
 * Runs skill and target selection for the change and saves `skills.json`. Targets are offered only
 * in full reviews. When `rulePlugins` is non-empty, a failed skill selection stops the review;
 * when `rulePlugins` is empty (target-only selection), a failure degrades to no targets selected.
 */
export async function chooseSkills(
  steps: ReviewSteps,
  run: {
    out: string
    tree: string
    title: string
    plan: Pick<ReviewPlan, 'mode' | 'sinceSha'>
    skills: RuleSkill[]
    settings: object
  },
): Promise<SkillChoice> {
  const source = run.plan.sinceSha !== null ? 'since' : 'diff'
  const offers =
    run.plan.mode === 'full'
      ? enabledReviewTargets(steps.references, steps.targets).map(({ name, when }) => ({
          name,
          when,
        }))
      : []
  const choice = await selectSkills({
    title: run.title,
    index: read(join(run.out, source, 'INDEX.md')),
    excerpt: diffExcerpt(splitDiff(read(join(run.out, `${source}.patch`)))),
    skills: run.skills,
    ...(offers.length === 0 ? {} : { targets: offers }),
    rulePlugins: steps.rulePlugins,
    settings: run.settings,
    ...(steps.models === undefined ? {} : { models: steps.models }),
    exec: steps.exec,
    cwd: run.tree,
  })
  writeJson(join(run.out, 'skills.json'), choice)
  if (choice.error !== undefined) {
    if (steps.rulePlugins.length === 0) return { ...choice, targets: [] }
    saveFailedSteps(run.out, [{ step: 'selection', ran: choice.ran }])
    throw new ReviewError(`Skill selection failed, so no review was run: ${choice.error}`)
  }
  return choice
}
