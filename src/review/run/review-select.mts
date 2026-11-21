import { join } from 'node:path'

import { diffExcerpt, splitDiff } from '../diff-files.mts'
import { ReviewError } from '../finding.mts'
import { read, writeJson, type ReviewSteps } from './review-support.mts'
import { selectSkills, type RuleSkill } from './select-skills.mts'
import type { SkillChoice } from './types.mts'

/**
 * Runs skill selection for the change and saves `skills.json`. A review without its rule skills
 * looks like any other review, so a selection that failed throws instead.
 */
export async function chooseSkills(
  steps: ReviewSteps,
  run: {
    out: string
    tree: string
    title: string
    followUp: boolean
    skills: RuleSkill[]
    settings: object
  },
): Promise<SkillChoice> {
  const source = run.followUp ? 'since' : 'diff'
  const choice = await selectSkills({
    title: run.title,
    index: read(join(run.out, source, 'INDEX.md')),
    excerpt: diffExcerpt(splitDiff(read(join(run.out, `${source}.patch`)))),
    skills: run.skills,
    rulePlugins: steps.rulePlugins,
    settings: run.settings,
    ...(steps.models === undefined ? {} : { models: steps.models }),
    exec: steps.exec,
    cwd: run.tree,
  })
  writeJson(join(run.out, 'skills.json'), choice)
  if (choice.error !== undefined) {
    throw new ReviewError(`Skill selection failed, so no review was run: ${choice.error}`)
  }
  return choice
}
