import { pool } from '../run/pool.mts'
import { ruleExcerpts } from './rule-excerpts.mts'
import type {
  BuiltContext,
  ContextDeps,
  ContextInput,
  ContextSection,
  SectionBuilder,
} from './types.mts'

/** One line per section; a later change adds its builder here. */
export const SECTIONS: readonly SectionBuilder[] = [ruleExcerpts]

const JOBS = 3

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
