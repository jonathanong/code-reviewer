import { pool } from '../run/pool.mts'
import { changeShape } from './change-shape/index.mts'
import { changedLineHistory } from './changed-line-history.mts'
import { linkedRegressions } from './linked-regressions.mts'
import { otherReviewers } from './other-reviewers.mts'
import { pastReviews } from './past-reviews.mts'
import { ruleExcerpts } from './rule-excerpts.mts'
import type {
  BuiltContext,
  ContextDeps,
  ContextInput,
  ContextSection,
  SectionBuilder,
} from './types.mts'

/** One line per section; a later change adds its builder here. */
export const SECTIONS: readonly SectionBuilder[] = [
  ruleExcerpts,
  changeShape,
  changedLineHistory,
  linkedRegressions,
  pastReviews,
  otherReviewers,
]

const JOBS = 3

/** The builders named `names`, in `SECTIONS` order; an unknown name throws. */
export function sectionsNamed(names: readonly string[]): SectionBuilder[] {
  const unknown = names.filter((name) => !SECTIONS.some((builder) => builder.name === name))
  if (unknown.length > 0) throw new Error(`unknown context section: ${unknown.join(', ')}`)
  return SECTIONS.filter((builder) => names.includes(builder.name))
}

/** Runs the builders (a few at a time), drops empty sections, and reports failures as notes. */
export async function buildContext(
  input: ContextInput,
  deps: ContextDeps,
  builders: readonly SectionBuilder[] = SECTIONS,
): Promise<BuiltContext> {
  const sections: (ContextSection | null)[] = builders.map(() => null)
  const notes: string[] = builders.map(() => '')
  await pool(
    builders.map((builder, index) => ({ builder, index })),
    JOBS,
    async ({ builder, index }) => {
      try {
        sections[index] = await builder.build(input, deps)
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error)
        notes[index] = `${builder.name} failed: ${reason.split('\n')[0]}`
      }
    },
  )
  return {
    sections: sections.filter((section) => section !== null),
    notes: notes.filter((note) => note !== ''),
  }
}
