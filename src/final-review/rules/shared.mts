import { referencePaths } from './collect.mts'

/** A shared rule source read from a local clone's default branch. */
export type SharedSource = {
  name: string
  /** Directory of the clone under the clone root. */
  cloneDir: string
  /** Path prefix in the clone holding `skills/<name>/SKILL.md`; staged paths drop it. */
  prefix: string
  /** Instruction files relative to the prefix. */
  instructions?: string[]
}

/** Every skill of each source is staged; the index lists them and pillars open what applies. */
export const SHARED_SOURCES: readonly SharedSource[] = [
  {
    name: 'no-mistakes-rules',
    cloneDir: 'no-mistakes',
    prefix: 'plugins/no-mistakes-rules/',
    instructions: ['AGENTS.md'],
  },
  { name: 'skills', cloneDir: 'skills', prefix: '' },
]

const SKILL = /^skills\/[^/]+\/SKILL\.md$/u

/** The clone paths (full, sorted) a source stages. */
export function sharedPaths(source: SharedSource, all: readonly string[]): string[] {
  const wanted = new Set((source.instructions ?? []).map((path) => `${source.prefix}${path}`))
  const skills = all.filter(
    (path) => path.startsWith(source.prefix) && SKILL.test(path.slice(source.prefix.length)),
  )
  for (const path of [...skills, ...referencePaths(all, skills)]) wanted.add(path)
  return all.filter((path) => wanted.has(path)).sort()
}
