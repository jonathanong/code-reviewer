import type { RunTextCommand } from '../../gh-cli/index.mts'
import type { Exec } from '../benchmark/exec.mts'
import type { TrustedAuthors } from '../trust.mts'
import type { RuleSkill } from '../run/select-skills.mts'

/** A selected rule skill with the absolute path of its SKILL.md. */
export type ContextSkill = RuleSkill & { file: string }

export type ContextInput = {
  /** `owner/name`. */
  repo: string
  pr: number
  /** A checkout of the pull request head. */
  tree: string
  baseSha: string
  headSha: string
  /** The run directory the context may be written to. */
  out: string
  skills: readonly ContextSkill[]
}

/** One part of the shared context: a title and a markdown body without its heading. */
export type ContextSection = { title: string; body: string }

/** What builders may touch, injected so tests use fakes. */
export type ContextDeps = {
  exec: Exec
  readFile(path: string): Promise<string>
  /**
   * The three members below are optional so sections that do not need them (and their tests)
   * need not supply them; a section that does reports their absence as a note.
   */
  /** `gh` for the pull request's owner. */
  gh?: RunTextCommand
  /** This reviewer's own logins; empty when the lookup found none. */
  trusted?: () => Promise<TrustedAuthors>
  /** The machine-local state directory holding the tracker. */
  stateDir?: string
}

/** `null` means the section has nothing to say for this pull request. */
export type SectionBuilder = {
  name: string
  build(input: ContextInput, deps: ContextDeps): Promise<ContextSection | null>
}

export type BuiltContext = {
  sections: ContextSection[]
  /** One line per builder that failed; a failure never fails the build. */
  notes: string[]
}
